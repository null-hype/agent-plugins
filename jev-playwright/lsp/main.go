// jev-lsp shows a jev-playwright run on the tests that asked its Questions:
// a diagnostic on each test whose answer was out of range, not collected or
// skipped, and go-to-definition from that test to the evidence Jev judged.
//
// It reads JEV_RUN_DIR, or the newest run under the nearest runs/ directory
// above the open file, and publishes again when a newer run lands.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  any             `json:"result,omitempty"`
}

type server struct {
	out    io.Writer
	sendMu sync.Mutex
	mu     sync.Mutex
	docs   map[string]string
	// What each open document was last published against: run dir and mtime.
	shown map[string]string
}

func newServer(out io.Writer) *server {
	return &server{out: out, docs: map[string]string{}, shown: map[string]string{}}
}

func main() {
	log.SetOutput(os.Stderr)
	s := newServer(os.Stdout)
	go s.watch(2 * time.Second)
	if err := s.serve(os.Stdin); err != nil && err != io.EOF {
		log.Fatal(err)
	}
}

func (s *server) serve(in io.Reader) error {
	r := bufio.NewReader(in)
	for {
		m, err := read(r)
		if err != nil {
			return err
		}
		if m.Method == "exit" {
			return nil
		}
		s.handle(m)
	}
}

func read(r *bufio.Reader) (message, error) {
	var m message
	length := -1
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return m, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if v, ok := strings.CutPrefix(line, "Content-Length:"); ok {
			length, _ = strconv.Atoi(strings.TrimSpace(v))
		}
	}
	if length < 0 {
		return m, fmt.Errorf("missing Content-Length")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return m, err
	}
	return m, json.Unmarshal(body, &m)
}

func (s *server) send(m message) {
	m.JSONRPC = "2.0"
	b, _ := json.Marshal(m)
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	fmt.Fprintf(s.out, "Content-Length: %d\r\n\r\n%s", len(b), b)
}

func (s *server) reply(id json.RawMessage, result any) {
	if result == nil {
		// A JSON-RPC response must carry a result; null is a valid one.
		result = json.RawMessage("null")
	}
	s.send(message{ID: id, Result: result})
}

type docParams struct {
	TextDocument struct {
		URI  string `json:"uri"`
		Text string `json:"text"`
	} `json:"textDocument"`
	ContentChanges []struct {
		Text string `json:"text"`
	} `json:"contentChanges"`
	Position Position `json:"position"`
}

func (s *server) handle(m message) {
	var p docParams
	_ = json.Unmarshal(m.Params, &p)
	uri := p.TextDocument.URI
	switch m.Method {
	case "initialize":
		s.reply(m.ID, map[string]any{
			"capabilities": map[string]any{
				"textDocumentSync":   map[string]any{"openClose": true, "change": 1, "save": true},
				"definitionProvider": true,
			},
			"serverInfo": map[string]string{"name": "jev-lsp"},
		})
	case "shutdown":
		s.reply(m.ID, nil)
	case "textDocument/didOpen":
		s.setDoc(uri, p.TextDocument.Text)
		s.publish(uri)
	case "textDocument/didChange":
		if n := len(p.ContentChanges); n > 0 {
			s.setDoc(uri, p.ContentChanges[n-1].Text)
		}
	case "textDocument/didSave":
		s.publish(uri)
	case "textDocument/didClose":
		s.mu.Lock()
		delete(s.docs, uri)
		delete(s.shown, uri)
		s.mu.Unlock()
	case "textDocument/definition":
		var locs []Location
		if path, err := uriToPath(uri); err == nil {
			if dir, err := findRun(path); err == nil {
				if c, err := loadComparison(dir); err == nil {
					locs = definition(path, p.Position.Line, c, dir)
				}
			}
		}
		s.reply(m.ID, locs)
	default:
		if m.ID != nil {
			s.reply(m.ID, nil)
		}
	}
}

func (s *server) setDoc(uri, text string) {
	s.mu.Lock()
	s.docs[uri] = text
	s.mu.Unlock()
}

// publish sends this document's diagnostics for the run it is shown against.
func (s *server) publish(uri string) {
	s.mu.Lock()
	text, open := s.docs[uri]
	s.mu.Unlock()
	if !open {
		return
	}
	diags := []Diagnostic{}
	key := ""
	if path, err := uriToPath(uri); err == nil {
		if dir, err := findRun(path); err == nil {
			key = runKey(dir)
			if c, err := loadComparison(dir); err == nil {
				diags = diagnostics(path, text, c)
			}
		}
	}
	s.mu.Lock()
	s.shown[uri] = key
	s.mu.Unlock()
	params, _ := json.Marshal(map[string]any{"uri": uri, "diagnostics": diags})
	s.send(message{Method: "textDocument/publishDiagnostics", Params: params})
}

// watch publishes again whenever a document's run is replaced by a newer one.
func (s *server) watch(every time.Duration) {
	for range time.Tick(every) {
		s.mu.Lock()
		var stale []string
		for uri, key := range s.shown {
			if path, err := uriToPath(uri); err == nil {
				if dir, err := findRun(path); err == nil && runKey(dir) != key {
					stale = append(stale, uri)
				}
			}
		}
		s.mu.Unlock()
		for _, uri := range stale {
			s.publish(uri)
		}
	}
}

func runKey(dir string) string {
	info, err := os.Stat(filepath.Join(dir, "comparison.json"))
	if err != nil {
		return dir
	}
	return fmt.Sprintf("%s@%d", dir, info.ModTime().UnixNano())
}

func uriToPath(uri string) (string, error) {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "file" {
		return "", fmt.Errorf("not a file URI: %s", uri)
	}
	return filepath.FromSlash(u.Path), nil
}

func pathToURI(path string) string {
	abs, _ := filepath.Abs(path)
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(abs)}).String()
}
