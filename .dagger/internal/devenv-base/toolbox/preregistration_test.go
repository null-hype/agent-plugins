package main

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestClaimPreregistration(t *testing.T) {
	data, err := os.ReadFile("testdata/completed-claim-preregistration.json")
	if err != nil {
		t.Fatal(err)
	}
	var claim completedClaim
	if err := json.Unmarshal(data, &claim); err != nil {
		t.Fatal(err)
	}
	view := projectPreregistration(claim.Preregistration)
	if view.Lines[5].Diagnostics[0].Column != 5 || strings.Contains(view.Lines[5].Diagnostics[0].Message, "stale") {
		t.Fatalf("bad projection: %+v", view)
	}
	body, err := renderClaim(claim)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{`data-static-preregistration`, `data-line="6" data-column="5" data-severity="warning"`, `Observed +0.24`, `evidence/verdict.json`, `prediction = 0.0`, `setModelMarkers`, `renderValidationDecorations:"on"`} {
		if !bytes.Contains(body, []byte(text)) {
			t.Errorf("missing %q", text)
		}
	}
	// Untrusted source and finding messages are text, including in the hidden
	// source element and the JSON consumed by other viewers.
	claim.Preregistration.Source = "</pre><script>attack()</script>"
	claim.Preregistration.Findings = json.RawMessage(`{"version":1,"findings":[{"location":{"file":"delivery/Preregistration.pkl","line":1,"column":1},"severity":"error","sourceHash":"sha256:old","message":"</p><script>attack()</script>"},{"location":{"file":"work.spec.ts","line":1,"column":1},"message":"unrelated"}]}`)
	view = projectPreregistration(claim.Preregistration)
	if !strings.HasPrefix(view.Lines[0].Diagnostics[0].Message, "stale finding (verified against other source): ") || !strings.HasPrefix(view.Notice, "1 finding(s) refer") {
		t.Fatalf("bad stale projection: %+v", view)
	}
	body, err = renderClaim(claim)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(body, []byte("<script>attack()")) {
		t.Fatal("unescaped source or finding")
	}
	for _, findings := range []json.RawMessage{nil, json.RawMessage(`{"version":2}`), json.RawMessage(`{"version":1,"findings":[]}`)} {
		claim.Preregistration.Findings = findings
		view = projectPreregistration(claim.Preregistration)
		if len(view.Lines[0].Diagnostics) != 0 || view.Notice == "" {
			t.Fatalf("missing explicit findings state: %+v", view)
		}
	}
}
