// jev-lsp projects a jev-playwright run onto the .pcf that declared it:
// one diagnostic per question whose answer was out of range, not collected or
// skipped, and go-to-definition from a question to the evidence Jev judged.
//
// It reads the newest run under runs/ next to the .pcf, or JEV_RUN_DIR.
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
)

type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  any             `json:"result,omitempty"`
}

type server struct {
	out  io.Writer
	mu   sync.Mutex
	docs map[string]string
}

func main() {
	log.SetOutput(os.Stderr)
	s := &server{out: os.Stdout, docs: map[string]string{}}
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
	s.mu.Lock()
	defer s.mu.Unlock()
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
		s.docs[uri] = p.TextDocument.Text
		s.publish(uri)
	case "textDocument/didChange":
		if n := len(p.ContentChanges); n > 0 {
			s.docs[uri] = p.ContentChanges[n-1].Text
		}
	case "textDocument/didSave":
		s.publish(uri)
	case "textDocument/didClose":
		delete(s.docs, uri)
	case "textDocument/definition":
		var locs []Location
		if c, dir, err := runFor(uri); err == nil {
			locs = definition(s.docs[uri], p.Position.Line, c, dir)
		}
		s.reply(m.ID, locs)
	default:
		if m.ID != nil {
			s.reply(m.ID, nil)
		}
	}
}

func (s *server) publish(uri string) {
	if !strings.HasSuffix(uri, ".pcf") {
		return
	}
	diags := []Diagnostic{}
	if c, _, err := runFor(uri); err == nil {
		diags = diagnostics(s.docs[uri], c)
	} else {
		log.Print(err)
	}
	params, _ := json.Marshal(map[string]any{"uri": uri, "diagnostics": diags})
	s.send(message{Method: "textDocument/publishDiagnostics", Params: params})
}

// runFor picks the run a .pcf is shown against.
func runFor(uri string) (Comparison, string, error) {
	dir := os.Getenv("JEV_RUN_DIR")
	if dir == "" {
		path, err := uriToPath(uri)
		if err != nil {
			return Comparison{}, "", err
		}
		if dir, err = latestRun(filepath.Join(filepath.Dir(path), "runs")); err != nil {
			return Comparison{}, "", err
		}
	}
	c, err := loadComparison(dir)
	return c, dir, err
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
