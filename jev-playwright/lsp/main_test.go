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

const spec = `import { test, expect } from '../ask';

test("Can Alice read Bob's private document?", async ({ ask }) => {
  await ask({});
});

test('Can Bob read it?', async ({ ask }) => {
  await ask({});
});
`

func comparison(aliceBaseline string) string {
	loc := func(line int) string {
		return fmt.Sprintf(`"location":{"file":"tests/questions.spec.ts","line":%d,"column":1}`, line)
	}
	return `{"runId":"r1","questions":{
 "baseline-alice-reads":{` + aliceBaseline + `,"expected":{"min":0,"max":0.2},"blockedBy":[],"error":null,` + loc(3) + `},
 "patched-alice-reads":{"outcome":"in-range","probability":0.05,"expected":{"min":0,"max":0.2},"blockedBy":[],"error":null,` + loc(3) + `},
 "baseline-bob-reads":{"outcome":"in-range","probability":0.95,"expected":{"min":0.8,"max":1},"blockedBy":[],"error":null,` + loc(7) + `},
 "patched-bob-reads":{"outcome":"dependency-skipped","probability":null,"expected":{"min":0.8,"max":1},"blockedBy":["baseline-bob-reads"],"error":null,` + loc(7) + `}}}`
}

const outOfRange = `"outcome":"out-of-range","probability":0.95`

func frame(method string, id int, params any) string {
	m := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
	if id > 0 {
		m["id"] = id
	}
	b, _ := json.Marshal(m)
	return fmt.Sprintf("Content-Length: %d\r\n\r\n%s", len(b), b)
}

// harness lays out a run the way run.mjs does and returns the spec's URI.
func harness(t *testing.T) (dir, uri string) {
	t.Setenv("JEV_RUN_DIR", "")
	dir = t.TempDir()
	writeRun(t, dir, "r1", outOfRange)
	specPath := filepath.Join(dir, "tests", "questions.spec.ts")
	os.MkdirAll(filepath.Dir(specPath), 0o755)
	os.WriteFile(specPath, []byte(spec), 0o644)
	return dir, pathToURI(specPath)
}

func writeRun(t *testing.T, dir, id, aliceBaseline string) {
	run := filepath.Join(dir, "runs", id)
	for _, q := range []string{"baseline-alice-reads", "patched-alice-reads"} {
		os.MkdirAll(filepath.Join(run, "questions", q), 0o755)
		for _, f := range evidenceFiles {
			os.WriteFile(filepath.Join(run, "questions", q, f), []byte("{}"), 0o644)
		}
	}
	os.WriteFile(filepath.Join(run, "scores.json"), []byte(`{"scores":{"baseline-alice-reads":{"backend":"mock"}}}`), 0o644)
	if err := os.WriteFile(filepath.Join(run, "comparison.json"), []byte(comparison(aliceBaseline)), 0o644); err != nil {
		t.Fatal(err)
	}
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

// The diagnostics an editor shows are the assertion: a warning on the test
// whose answer was out of range, beside its run button; information on the one
// skipped; nothing for answers in range.
func TestServerShowsRunOnTheTestsThatAsked(t *testing.T) {
	_, uri := harness(t)
	in := frame("initialize", 1, map[string]any{}) +
		frame("textDocument/didOpen", 0, map[string]any{"textDocument": map[string]any{"uri": uri, "text": spec}}) +
		frame("textDocument/definition", 2, map[string]any{"textDocument": map[string]any{"uri": uri}, "position": map[string]int{"line": 2, "character": 5}}) +
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

	if len(diags) != 2 {
		t.Fatalf("want 2 diagnostics, got %d: %+v", len(diags), diags)
	}
	alice, bob := diags[0], diags[1]
	if alice.Range.Start.Line != 2 || alice.Severity != severityWarning ||
		alice.Message != "baseline-alice-reads: Mock answer 0.95, outside expected [0, 0.2]" {
		t.Errorf("alice: %+v", alice)
	}
	if bob.Range.Start.Line != 6 || bob.Severity != severityInformation || !strings.HasPrefix(bob.Message, "patched-bob-reads: skipped") {
		t.Errorf("bob: %+v", bob)
	}
	// The Alice test asked both revisions: peek offers the evidence for each.
	if len(defs) != 6 || !strings.HasSuffix(defs[0].URI, "baseline-alice-reads/state.json") ||
		!strings.HasSuffix(defs[3].URI, "patched-alice-reads/state.json") {
		t.Errorf("definition: %+v", defs)
	}
}

// A newer run replaces what an open test shows, without reopening it.
func TestServerPublishesANewerRun(t *testing.T) {
	dir, uri := harness(t)
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	s := newServer(outW)
	go s.serve(inR)
	go s.watch(20 * time.Millisecond)
	published := make(chan []Diagnostic, 8)
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
	io.WriteString(inW, frame("textDocument/didOpen", 0, map[string]any{"textDocument": map[string]any{"uri": uri, "text": spec}}))
	if first := <-published; len(first) != 2 {
		t.Fatalf("first publish: %+v", first)
	}

	time.Sleep(20 * time.Millisecond) // a later mtime than r1
	writeRun(t, dir, "r2", `"outcome":"in-range","probability":0.1`)
	select {
	case next := <-published:
		if len(next) != 1 || next[0].Range.Start.Line != 6 {
			t.Errorf("after the newer run: %+v", next)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the newer run was not published")
	}
}
