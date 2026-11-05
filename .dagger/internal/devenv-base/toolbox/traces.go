package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// OpenRouter's Broadcast sends a trace of every request made with the
// account's keys to a webhook, as OTLP JSON, after the request finishes
// (https://openrouter.ai/docs/guides/features/broadcast/webhook). The
// OpenRouter agent tags each request with its Linear session as session_id
// and one trace per turn (linear-agent/src/openrouter.ts), so this sink keeps
// what ~/.claude keeps for the Claude agent: everything the model was sent and
// sent back, per session. It lives on the toolbox, not the host, because
// traces arrive after the turn, when the VM may already be stopping.
//
// POST or PUT /openrouter/traces stores; Broadcast signs nothing, so the
// destination is configured with the header "Authorization: Bearer
// <OPENROUTER_TRACE_TOKEN>". GET /openrouter/traces/<session> reads one
// session's traces back, as NDJSON (one OTLP payload per line), behind
// TOOLBOX_TOKEN like /mcp. Traces hold issue text and tool output, so they
// stay on the disk and are not published anywhere.

const traceBodyLimit = 32 << 20

// traceRetention is how long a session's traces are kept after its last write.
const traceRetention = 30 * 24 * time.Hour

type traceSink struct {
	token string
	dir   string
	mu    sync.Mutex
	now   func() time.Time
}

func newTraceSink(token, dir string) *traceSink {
	return &traceSink{token: token, dir: dir, now: time.Now}
}

func (s *traceSink) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost && req.Method != http.MethodPut {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Saving the destination sends an empty payload with this header first.
	if req.Header.Get("X-Test-Connection") == "true" {
		w.WriteHeader(http.StatusOK)
		return
	}
	body, err := io.ReadAll(io.LimitReader(req.Body, traceBodyLimit+1))
	if err != nil || len(body) > traceBodyLimit {
		http.Error(w, "bad body", http.StatusRequestEntityTooLarge)
		return
	}
	bySession, err := splitBySession(body)
	if err != nil {
		http.Error(w, "invalid OTLP JSON", http.StatusBadRequest)
		return
	}
	if err := s.store(bySession); err != nil {
		log.Printf("openrouter traces: not stored: %v", err)
		http.Error(w, "not stored", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// read serves GET /openrouter/traces/<session>.
func (s *traceSink) read(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	session := strings.TrimPrefix(req.URL.Path, "/openrouter/traces/")
	if session == "" || strings.Contains(session, "/") {
		http.NotFound(w, req)
		return
	}
	s.mu.Lock()
	b, err := os.ReadFile(s.file(session))
	s.mu.Unlock()
	if err != nil {
		http.NotFound(w, req)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	_, _ = w.Write(b)
}

// noSession keeps spans whose request carried no session_id, such as a
// request made with the account's key outside the agent.
const noSession = "_no-session"

// splitBySession regroups an OTLP payload by each span's session.id, keeping
// every resource and scope a span came with, so that each session's file
// holds whole, valid OTLP payloads.
func splitBySession(body []byte) (map[string][]byte, error) {
	var p struct {
		ResourceSpans []struct {
			Resource   json.RawMessage `json:"resource,omitempty"`
			SchemaURL  string          `json:"schemaUrl,omitempty"`
			ScopeSpans []struct {
				Scope     json.RawMessage   `json:"scope,omitempty"`
				SchemaURL string            `json:"schemaUrl,omitempty"`
				Spans     []json.RawMessage `json:"spans"`
			} `json:"scopeSpans"`
		} `json:"resourceSpans"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	type scope struct {
		Scope     json.RawMessage   `json:"scope,omitempty"`
		SchemaURL string            `json:"schemaUrl,omitempty"`
		Spans     []json.RawMessage `json:"spans"`
	}
	type resource struct {
		Resource   json.RawMessage `json:"resource,omitempty"`
		SchemaURL  string          `json:"schemaUrl,omitempty"`
		ScopeSpans []scope         `json:"scopeSpans"`
	}
	groups := map[string][]resource{}
	for _, rs := range p.ResourceSpans {
		perSession := map[string]*resource{}
		var order []string
		for _, ss := range rs.ScopeSpans {
			perScope := map[string]*scope{}
			for _, span := range ss.Spans {
				id := spanSession(span)
				r, ok := perSession[id]
				if !ok {
					r = &resource{Resource: rs.Resource, SchemaURL: rs.SchemaURL}
					perSession[id] = r
					order = append(order, id)
				}
				sc, ok := perScope[id]
				if !ok {
					r.ScopeSpans = append(r.ScopeSpans, scope{Scope: ss.Scope, SchemaURL: ss.SchemaURL})
					sc = &r.ScopeSpans[len(r.ScopeSpans)-1]
					perScope[id] = sc
				}
				sc.Spans = append(sc.Spans, span)
			}
		}
		for _, id := range order {
			groups[id] = append(groups[id], *perSession[id])
		}
	}
	out := map[string][]byte{}
	for id, rs := range groups {
		b, err := json.Marshal(map[string]any{"resourceSpans": rs})
		if err != nil {
			return nil, err
		}
		out[id] = b
	}
	return out, nil
}

// spanSession is a span's session.id attribute, or noSession.
func spanSession(span json.RawMessage) string {
	var s struct {
		Attributes []struct {
			Key   string `json:"key"`
			Value struct {
				StringValue string `json:"stringValue"`
			} `json:"value"`
		} `json:"attributes"`
	}
	if json.Unmarshal(span, &s) == nil {
		for _, a := range s.Attributes {
			if a.Key == "session.id" && a.Value.StringValue != "" {
				return a.Value.StringValue
			}
		}
	}
	return noSession
}

var safeSession = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// file is where a session's traces are kept: <dir>/<session>.ndjson for an
// id that is safe as a file name (Linear's are UUIDs), otherwise its hash.
func (s *traceSink) file(session string) string {
	name := session
	if !safeSession.MatchString(session) || strings.HasPrefix(session, ".") {
		sum := sha256.Sum256([]byte(session))
		name = hex.EncodeToString(sum[:])
	}
	return filepath.Join(s.dir, name+".ndjson")
}

func (s *traceSink) store(bySession map[string][]byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for session, b := range bySession {
		f, err := os.OpenFile(s.file(session), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		_, err = f.Write(append(bytes.TrimSpace(b), '\n'))
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// prune removes sessions not written to within traceRetention.
func (s *traceSink) prune() {
	files, _ := filepath.Glob(filepath.Join(s.dir, "*.ndjson"))
	for _, f := range files {
		if fi, err := os.Stat(f); err == nil && s.now().Sub(fi.ModTime()) > traceRetention {
			_ = os.Remove(f)
		}
	}
}

// traceSinkDir is OPENROUTER_TRACE_DIR, or traces/ beside the relay's
// records on the same persistent disk.
func traceSinkDir(getenv func(string) string) string {
	if d := getenv("OPENROUTER_TRACE_DIR"); d != "" {
		return d
	}
	if root := getenv("LINEAR_AGENT_RELAY_DIR"); root != "" {
		return filepath.Join(root, "traces")
	}
	return ""
}
