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
	shown  map[string]string
}

func newServer(out io.Writer) *server {
	return &server{out: out, docs: map[string]string{}, shown: map[string]string{}}
}

func main() {
	log.SetOutput(os.Stderr)
	s := newServer(os.Stdout)
	go s.watch(500 * time.Millisecond)
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
			if runDir, err := findRun(path); err == nil {
				if run, err := loadRun(runDir); err == nil {
					locs = definition(path, p.Position.Line, run, runDir)
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
		if runDir, err := findRun(path); err == nil {
			key = runKey(runDir)
			if run, err := loadRun(runDir); err == nil {
				diags = diagnostics(path, text, run)
			}
		}
	}

	s.mu.Lock()
	s.shown[uri] = key
	s.mu.Unlock()
	params, _ := json.Marshal(map[string]any{"uri": uri, "diagnostics": diags})
	s.send(message{Method: "textDocument/publishDiagnostics", Params: params})
}

func (s *server) watch(every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		shown := make(map[string]string, len(s.shown))
		for uri, key := range s.shown {
			shown[uri] = key
		}
		s.mu.Unlock()
		for uri, key := range shown {
			path, err := uriToPath(uri)
			if err != nil {
				continue
			}
			runDir, err := findRun(path)
			if err != nil {
				continue
			}
			if next := runKey(runDir); next != key {
				s.publish(uri)
			}
		}
	}
}

func runKey(runDir string) string {
	info, err := os.Stat(filepath.Join(runDir, "findings.json"))
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s@%d:%d", runDir, info.ModTime().UnixNano(), info.Size())
}

func findRun(path string) (string, error) {
	if dir := os.Getenv("JEV_RUN_DIR"); dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "findings.json")); err != nil {
			return "", fmt.Errorf("JEV_RUN_DIR has no findings.json: %s", dir)
		}
		return dir, nil
	}
	for dir := filepath.Dir(path); ; dir = filepath.Dir(dir) {
		run := filepath.Join(dir, ".jev", "run")
		if _, err := os.Stat(filepath.Join(run, "findings.json")); err == nil {
			return run, nil
		}
		if parent := filepath.Dir(dir); parent == dir {
			return "", fmt.Errorf("no .jev/run/findings.json above %s", path)
		}
	}
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
