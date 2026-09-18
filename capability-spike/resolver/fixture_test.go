package resolver

import (
	"os"
	"regexp"
	"testing"
)

// installShReasonPattern extracts every phrase install.sh's generated
// `color` bin actually emits after "${AGENT_ASSIGNMENT} scenario: ", in
// the order those PROTON_PASS_AGENT_REASON lines appear in the file.
var installShReasonPattern = regexp.MustCompile(`\$\{AGENT_ASSIGNMENT\} scenario: ([^"]+)"`)

// scenarioNamePattern extracts the real AGENT_ASSIGNMENT value a
// test/_global/*/Dockerfile pins via `ARG SCENARIO_NAME=...`.
var scenarioNamePattern = regexp.MustCompile(`ARG SCENARIO_NAME=(\S+)`)

// TestFixturesAreVerbatim is CIT-149's "verbatim, not authored" acceptance
// criterion made mechanical. It does not settle for checking that some
// hardcoded phrase and some hardcoded scope each separately appear
// somewhere in the source files -- that leaves the fixture constants
// themselves unchecked, so any of them could be edited to say anything
// (an invented phrase under a real scope, say) without failing. Instead it
// extracts the real phrases from install.sh and the real scope from each
// Dockerfile, reconstructs the "<scope> scenario: <phrase>" string those
// sources actually produce, and asserts each fixture constant equals that
// reconstruction exactly.
func TestFixturesAreVerbatim(t *testing.T) {
	installSh := readFixtureSource(t, "../../src/pass-cli/install.sh")
	phrases := installShReasonPattern.FindAllStringSubmatch(installSh, -1)
	if len(phrases) != 3 {
		t.Fatalf("expected exactly 3 PROTON_PASS_AGENT_REASON scenario lines in install.sh, found %d -- update this test alongside fixture.go", len(phrases))
	}
	// In file order: install.sh:43 (favorite color), :89 (plant codeword),
	// :126 (read codeword) -- see fixture.go's own comments for why these
	// three, in this order.
	favoriteColorPhrase := phrases[0][1]
	plantCodewordPhrase := phrases[1][1]
	readCodewordPhrase := phrases[2][1]

	jin91Scope := extractScenarioName(t, "../../test/_global/jin-91-resume-session/Dockerfile")
	jin81Scope := extractScenarioName(t, "../../test/_global/jin-81-pass-cli/Dockerfile")

	for _, c := range []struct {
		name    string
		fixture string
		want    string
	}{
		{"FixtureReason", FixtureReason, jin91Scope + " scenario: " + plantCodewordPhrase},
		{"FixtureReasonGranted", FixtureReasonGranted, jin91Scope + " scenario: " + readCodewordPhrase},
		{"FixtureReasonUnresolved", FixtureReasonUnresolved, jin81Scope + " scenario: " + favoriteColorPhrase},
	} {
		if c.fixture != c.want {
			t.Errorf("%s = %q, want %q (reconstructed from the real scope in its Dockerfile and the real phrase in install.sh) -- this fixture no longer matches its source, verbatim", c.name, c.fixture, c.want)
		}
	}
}

func extractScenarioName(t *testing.T, dockerfilePath string) string {
	t.Helper()
	data := readFixtureSource(t, dockerfilePath)
	m := scenarioNamePattern.FindStringSubmatch(data)
	if m == nil {
		t.Fatalf("%s: no \"ARG SCENARIO_NAME=...\" line found", dockerfilePath)
	}
	return m[1]
}

func readFixtureSource(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}
