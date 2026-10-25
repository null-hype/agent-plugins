package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const pcf = `questions {
  ["baseline-alice-reads"] = (aliceReads) { revision = "baseline" }
  ["baseline-bob-reads"] = (bobReads) { revision = "baseline" }
  ["patched-alice-reads"] = (aliceReads) { revision = "patched" }
}
`

const comparison = `{"runId":"r1","questions":{
 "baseline-alice-reads":{"outcome":"out-of-range","probability":0.95,"expected":{"min":0,"max":0.2},"blockedBy":[],"error":null},
 "baseline-bob-reads":{"outcome":"in-range","probability":0.95,"expected":{"min":0.8,"max":1},"blockedBy":[],"error":null},
 "patched-alice-reads":{"outcome":"dependency-skipped","probability":null,"expected":{"min":0,"max":0.2},"blockedBy":["baseline-alice-reads"],"error":null}}}`

func frame(method string, id int, params any) string {
	m := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	if id > 0 {
		m["id"] = id
	}
	b, _ := json.Marshal(m)
	return fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(b), b)
}

// The diagnostics an editor shows are the test's assertion: one warning on the
// question Jev answered out of range, nothing on the one in range.
func TestServerProjectsRunOntoPcf(t *testing.T) {
	t.Setenv("JEV_RUN_DIR", "")
	dir := t.TempDir()
	run := filepath.Join(dir, "runs", "r1")
	qdir := filepath.Join(run, "questions", "baseline-alice-reads")
	if err := os.MkdirAll(qdir, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(run, "comparison.json"), []byte(comparison), 0o644)
	os.WriteFile(filepath.Join(run, "scores.json"), []byte(`{"scores":{"baseline-alice-reads":{"backend":"mock"}}}`), 0o644)
	for _, f := range evidenceFiles {
		os.WriteFile(filepath.Join(qdir, f), []byte("{}"), 0o644)
	}
	uri := pathToURI(filepath.Join(dir, "report-expected.pcf"))

	in := frame("initialize", 1, map[string]any{}) +
		frame("textDocument/didOpen", 0, map[string]any{"textDocument": map[string]any{"uri": uri, "text": pcf}}) +
		frame("textDocument/definition", 2, map[string]any{"textDocument": map[string]any{"uri": uri}, "position": map[string]int{"line": 1, "character": 4}}) +
		frame("shutdown", 3, nil) + frame("exit", 0, nil)

	var out bytes.Buffer
	s := &server{out: &out, docs: map[string]string{}}
	if err := s.serve(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}

	r := bufio.NewReader(&out)
	var diags []Diagnostic
	var defs []Location
	for {
		m, err := read(r)
		if err != nil {
			break
		}
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

	got := map[int]Diagnostic{}
	for _, d := range diags {
		got[d.Range.Start.Line] = d
	}
	if len(diags) != 2 {
		t.Fatalf("want 2 diagnostics, got %d: %+v", len(diags), diags)
	}
	if d := got[1]; d.Severity != severityWarning || d.Range.Start.Character != 2 || d.Message != "Mock answer 0.95, outside expected [0, 0.2]" {
		t.Errorf("baseline-alice-reads: %+v", d)
	}
	if _, ok := got[2]; ok {
		t.Errorf("in-range question got a diagnostic")
	}
	if d := got[3]; d.Severity != severityInformation || !strings.Contains(d.Message, "baseline-alice-reads") {
		t.Errorf("patched-alice-reads: %+v", d)
	}
	if len(defs) != 3 || !strings.HasSuffix(defs[0].URI, "baseline-alice-reads/state.json") {
		t.Errorf("definition: %+v", defs)
	}
}
