package resolver

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"dagger/capability-spike/supervisor"
)

// TestResolve_MatchesGoldenReasonLog anchors testdata/reason-log.jsonl as
// this package's own real, live output for the three fixtures -- not
// hand-typed JSON that merely looks plausible. The TypeScript replay in
// null-hype/null-hype.github.io (reasonResolver.ts) vendors a copy of this
// exact file for its own lesson preview, and that repo's own
// reasonResolver.spec.ts checks its copy against its own resolveReason()
// output the same way this test checks Go's. Neither side can run the
// other's language, so this is not a single cross-language CI check --
// it is two independent anchors to the same committed bytes, which at
// least makes a divergence a visible diff instead of an assumption.
func TestResolve_MatchesGoldenReasonLog(t *testing.T) {
	vocab := testVocabulary()
	grants := map[string]*supervisor.Grant{
		"pass-cli:color:resume:read-codeword": {FactID: "pass-cli:color:resume:read-codeword", Vault: "jin-91-resume-session", Approved: true},
	}

	var lines []string
	for _, raw := range []string{FixtureReasonGranted, FixtureReason, FixtureReasonUnresolved} {
		resolved := Resolve(raw, vocab, grants)
		encoded, err := json.Marshal(resolved)
		if err != nil {
			t.Fatalf("marshal %q: %v", raw, err)
		}
		lines = append(lines, string(encoded))
	}
	got := strings.Join(lines, "\n") + "\n"

	want, err := os.ReadFile("testdata/reason-log.jsonl")
	if err != nil {
		t.Fatalf("read testdata/reason-log.jsonl: %v", err)
	}

	if got != string(want) {
		t.Errorf("Resolve's live output no longer matches testdata/reason-log.jsonl (also vendored into null-hype.github.io's chapter-3/lesson-4 lesson) --\ngot:\n%s\nwant:\n%s", got, want)
	}
}
