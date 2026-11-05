package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A trimmed Broadcast payload: one resource, one scope, spans from two Linear
// sessions and one request made without a session.
const broadcastPayload = `{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"openrouter"}}]},
"scopeSpans":[{"scope":{"name":"openrouter"},"spans":[
 {"traceId":"aa","spanId":"1","name":"chat","attributes":[{"key":"session.id","value":{"stringValue":"sess-A"}},{"key":"trace.metadata.linear_issue","value":{"stringValue":"CIT-1"}}]},
 {"traceId":"bb","spanId":"2","name":"chat","attributes":[{"key":"session.id","value":{"stringValue":"sess-B"}}]},
 {"traceId":"aa","spanId":"3","name":"chat","attributes":[{"key":"session.id","value":{"stringValue":"sess-A"}}]},
 {"traceId":"cc","spanId":"4","name":"chat","attributes":[]}
]}]}]}`

func postTrace(t *testing.T, h http.Handler, auth, body string, hdr map[string]string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/openrouter/traces", strings.NewReader(body))
	if auth != "" {
		req.Header.Set("Authorization", "Bearer "+auth)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr.Code
}

// spanIDs reads a session file back as the span ids of each stored payload.
func spanIDs(t *testing.T, file string) [][]string {
	t.Helper()
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var out [][]string
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var p struct {
			ResourceSpans []struct {
				Resource   map[string]any `json:"resource"`
				ScopeSpans []struct {
					Scope map[string]any `json:"scope"`
					Spans []struct {
						SpanID string `json:"spanId"`
					} `json:"spans"`
				} `json:"scopeSpans"`
			} `json:"resourceSpans"`
		}
		if err := json.Unmarshal([]byte(line), &p); err != nil {
			t.Fatalf("stored line is not OTLP JSON: %v: %s", err, line)
		}
		var ids []string
		for _, rs := range p.ResourceSpans {
			if rs.Resource == nil {
				t.Fatalf("resource dropped: %s", line)
			}
			for _, ss := range rs.ScopeSpans {
				if ss.Scope["name"] != "openrouter" {
					t.Fatalf("scope dropped: %s", line)
				}
				for _, s := range ss.Spans {
					ids = append(ids, s.SpanID)
				}
			}
		}
		out = append(out, ids)
	}
	return out
}

func TestTraceSinkKeepsEachSessionsSpansAsOTLP(t *testing.T) {
	dir := t.TempDir()
	sink := newTraceSink("trace-secret", dir)
	if code := postTrace(t, sink, "trace-secret", broadcastPayload, nil); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if code := postTrace(t, sink, "trace-secret", broadcastPayload, nil); code != http.StatusOK {
		t.Fatalf("second status = %d", code)
	}
	a := spanIDs(t, filepath.Join(dir, "sess-A.ndjson"))
	if len(a) != 2 || strings.Join(a[0], ",") != "1,3" {
		t.Fatalf("sess-A = %v; want one line per payload with spans 1,3", a)
	}
	if b := spanIDs(t, filepath.Join(dir, "sess-B.ndjson")); len(b) != 2 || strings.Join(b[0], ",") != "2" {
		t.Fatalf("sess-B = %v", b)
	}
	if n := spanIDs(t, filepath.Join(dir, noSession+".ndjson")); strings.Join(n[0], ",") != "4" {
		t.Fatalf("no session = %v", n)
	}
}

func TestTraceSinkRefusesWhatBroadcastDidNotSend(t *testing.T) {
	dir := t.TempDir()
	sink := newTraceSink("trace-secret", dir)
	for _, auth := range []string{"", "wrong", "trace-secretX"} {
		if code := postTrace(t, sink, auth, broadcastPayload, nil); code != http.StatusUnauthorized {
			t.Fatalf("auth %q: status = %d", auth, code)
		}
	}
	if code := postTrace(t, sink, "trace-secret", "not json", nil); code != http.StatusBadRequest {
		t.Fatalf("bad body: status = %d", code)
	}
	// Saving the destination in OpenRouter tests it with an empty payload.
	if code := postTrace(t, sink, "trace-secret", "", map[string]string{"X-Test-Connection": "true"}); code != http.StatusOK {
		t.Fatalf("test connection: status = %d", code)
	}
	if files, _ := filepath.Glob(filepath.Join(dir, "*")); len(files) != 0 {
		t.Fatalf("stored %v", files)
	}
}

func TestTraceSinkFileNamesCannotEscapeItsDirectory(t *testing.T) {
	sink := newTraceSink("x", "/traces")
	for _, s := range []string{"../../etc/passwd", ".hidden", "a/b", strings.Repeat("x", 200)} {
		if f := sink.file(s); filepath.Dir(f) != "/traces" || strings.HasPrefix(filepath.Base(f), ".") {
			t.Fatalf("session %q -> %q", s, f)
		}
	}
	if f := sink.file("354f582b-fc34-4900-b7db-232ffed05cad"); f != "/traces/354f582b-fc34-4900-b7db-232ffed05cad.ndjson" {
		t.Fatalf("a Linear session id keeps its name: %q", f)
	}
}

func TestTraceSinkPrunesSessionsPastRetention(t *testing.T) {
	dir := t.TempDir()
	sink := newTraceSink("x", dir)
	old, fresh := filepath.Join(dir, "old.ndjson"), filepath.Join(dir, "fresh.ndjson")
	for _, f := range []string{old, fresh} {
		if err := os.WriteFile(f, []byte("{}\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	past := time.Now().Add(-traceRetention - time.Hour)
	_ = os.Chtimes(old, past, past)
	sink.prune()
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old session kept")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("fresh session pruned")
	}
}

// Through the toolbox's own mux: writes take the trace token, reads the
// toolbox token, and without OPENROUTER_TRACE_TOKEN there is no route.
func TestTraceRoutesOnTheToolbox(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("OPENROUTER_TRACE_TOKEN", "trace-secret")
	t.Setenv("OPENROUTER_TRACE_DIR", dir)
	mux := newMux("toolbox-secret", "https://toolbox.example", nil)
	if code := postTrace(t, mux, "trace-secret", broadcastPayload, nil); code != http.StatusOK {
		t.Fatalf("store: status = %d", code)
	}
	get := func(auth string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/openrouter/traces/sess-B", nil)
		if auth != "" {
			req.Header.Set("Authorization", "Bearer "+auth)
		}
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}
	if rr := get("trace-secret"); rr.Code != http.StatusUnauthorized {
		t.Fatalf("read with the write token: status = %d", rr.Code)
	}
	rr := get("toolbox-secret")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"spanId":"2"`) {
		t.Fatalf("read: %d %s", rr.Code, rr.Body.String())
	}

	t.Setenv("OPENROUTER_TRACE_TOKEN", "")
	off := newMux("toolbox-secret", "https://toolbox.example", nil)
	if code := postTrace(t, off, "trace-secret", broadcastPayload, nil); code != http.StatusNotFound {
		t.Fatalf("route without a token: status = %d", code)
	}
}
