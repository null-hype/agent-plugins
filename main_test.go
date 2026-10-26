package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const exampleSource = `export function canAliceReadBobPrivate() {
  return true;
}
`

func frame(method string, id int, params any) string {
	m := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	if id > 0 {
		m["id"] = id
	}
	b, _ := json.Marshal(m)
	return fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(b), b)
}

func messages(r io.Reader) []message {
	var out []message
	br := bufio.NewReader(r)
	for {
		m, err := read(br)
		if err != nil {
			return out
		}
		out = append(out, m)
	}
}

func fixture(t *testing.T) (root, uri string) {
	t.Helper()
	root = t.TempDir()
	source := filepath.Join(root, "example.ts")
	if err := os.WriteFile(source, []byte(exampleSource), 0o644); err != nil {
		t.Fatal(err)
	}
	run := filepath.Join(root, ".jev", "run")
	if err := os.MkdirAll(filepath.Join(run, "evidence"), 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(run, "evidence", "request.json"), []byte(`{"user":"alice"}`), 0o644)
	os.WriteFile(filepath.Join(run, "evidence", "response.json"), []byte(`{"allowed":true}`), 0o644)
	writeFindings(t, run, hashText(exampleSource), "warning", "Alice can read Bob's private document")
	return root, pathToURI(source)
}

func writeFindings(t *testing.T, run, hash, severity, message string) {
	t.Helper()
	data := Run{Version: 1, Findings: []Finding{{
		ID:         "alice-reads-bob",
		Location:   SourceLocation{File: "example.ts", Line: 2, Column: 3},
		Severity:   severity,
		Message:    message,
		SourceHash: "sha256:" + hash,
		Evidence:   []string{"evidence/request.json", "evidence/response.json"},
	}}}
	b, _ := json.MarshalIndent(data, "", "  ")
	if err := os.WriteFile(filepath.Join(run, "findings.json"), append(b, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestServerPublishesFindingAndEvidence(t *testing.T) {
	_, uri := fixture(t)
	in := frame("initialize", 1, map[string]any{}) +
		frame("textDocument/didOpen", 0, map[string]any{"textDocument": map[string]any{"uri": uri, "text": exampleSource}}) +
		frame("textDocument/definition", 2, map[string]any{"textDocument": map[string]any{"uri": uri}, "position": map[string]int{"line": 1, "character": 3}}) +
		frame("shutdown", 3, nil) + frame("exit", 0, nil)

	var out bytes.Buffer
	if err := newServer(&out).serve(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}
	var diags []Diagnostic
	var defs []Location
	for _, m := range messages(&out) {
		switch {
		case m.Method == "textDocument/publishDiagnostics":
			var p struct{ Diagnostics []Diagnostic }
			json.Unmarshal(m.Params, &p)
			diags = p.Diagnostics
		case string(m.ID) == "2":
			b, _ := json.Marshal(m.Result)
			json.Unmarshal(b, &defs)
		}
	}
	if len(diags) != 1 {
		t.Fatalf("want one diagnostic, got %+v", diags)
	}
	if d := diags[0]; d.Range.Start.Line != 1 || d.Severity != severityWarning || d.Code != "alice-reads-bob" || d.Message != "Alice can read Bob's private document" {
		t.Fatalf("diagnostic: %+v", d)
	}
	if len(defs) != 2 || !strings.HasSuffix(defs[0].URI, "evidence/request.json") || !strings.HasSuffix(defs[1].URI, "evidence/response.json") {
		t.Fatalf("definitions: %+v", defs)
	}
}

func TestFindingIsMarkedStaleWhenSourceChanges(t *testing.T) {
	_, uri := fixture(t)
	changed := strings.Replace(exampleSource, "return true", "return false", 1)
	in := frame("textDocument/didOpen", 0, map[string]any{"textDocument": map[string]any{"uri": uri, "text": changed}}) + frame("exit", 0, nil)
	var out bytes.Buffer
	if err := newServer(&out).serve(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}
	for _, m := range messages(&out) {
		if m.Method == "textDocument/publishDiagnostics" {
			var p struct{ Diagnostics []Diagnostic }
			json.Unmarshal(m.Params, &p)
			if len(p.Diagnostics) != 1 || !strings.HasPrefix(p.Diagnostics[0].Message, "stale finding") {
				t.Fatalf("diagnostics: %+v", p.Diagnostics)
			}
			return
		}
	}
	t.Fatal("nothing published")
}

func TestServerRepublishesWhenVerifierReplacesRun(t *testing.T) {
	root, uri := fixture(t)
	run := filepath.Join(root, ".jev", "run")
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	s := newServer(outW)
	go s.serve(inR)
	go s.watch(20 * time.Millisecond)
	published := make(chan []Diagnostic, 4)
	go func() {
		br := bufio.NewReader(outR)
		for {
			m, err := read(br)
			if err != nil {
				return
			}
			if m.Method == "textDocument/publishDiagnostics" {
				var p struct{ Diagnostics []Diagnostic }
				json.Unmarshal(m.Params, &p)
				published <- p.Diagnostics
			}
		}
	}()
	io.WriteString(inW, frame("textDocument/didOpen", 0, map[string]any{"textDocument": map[string]any{"uri": uri, "text": exampleSource}}))
	if first := <-published; len(first) != 1 || first[0].Severity != severityWarning {
		t.Fatalf("first publish: %+v", first)
	}
	time.Sleep(25 * time.Millisecond)
	writeFindings(t, run, hashText(exampleSource), "error", "Verifier changed its finding")
	select {
	case next := <-published:
		if len(next) != 1 || next[0].Severity != severityError || next[0].Message != "Verifier changed its finding" {
			t.Fatalf("after replacement: %+v", next)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("replacement run was not published")
	}
}
