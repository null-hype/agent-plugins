package resolver

import (
	"os"
	"strings"
	"testing"
)

// TestFixturesAreVerbatim is CIT-149's "verbatim, not authored" acceptance
// criterion made mechanical: it reads the real files the fixture constants
// claim to be copied from and fails if either the phrase or the scope
// tag drifts from what those files actually say, instead of trusting a
// comment to stay accurate.
func TestFixturesAreVerbatim(t *testing.T) {
	installSh := readFixtureSource(t, "../../src/pass-cli/install.sh")

	for _, phrase := range []string{
		"scenario: planting codeword in a fresh session",
		"scenario: resuming restored session to read back the codeword",
		"scenario: color bin asking claude its favorite color",
	} {
		if !strings.Contains(installSh, phrase) {
			t.Errorf("src/pass-cli/install.sh no longer contains the verbatim phrase %q -- fixture.go has drifted from its source", phrase)
		}
	}

	jin91 := readFixtureSource(t, "../../test/_global/jin-91-resume-session/Dockerfile")
	if !strings.Contains(jin91, "ARG SCENARIO_NAME=jin-91-resume-session") {
		t.Error("jin-91-resume-session/Dockerfile no longer pins SCENARIO_NAME=jin-91-resume-session -- FixtureReason's scope has drifted")
	}

	jin81 := readFixtureSource(t, "../../test/_global/jin-81-pass-cli/Dockerfile")
	if !strings.Contains(jin81, "ARG SCENARIO_NAME=jin-81-pass-cli") {
		t.Error("jin-81-pass-cli/Dockerfile no longer pins SCENARIO_NAME=jin-81-pass-cli -- FixtureReasonUnresolved's scope has drifted")
	}

	for name, fixture := range map[string]string{
		"FixtureReason":           FixtureReason,
		"FixtureReasonGranted":    FixtureReasonGranted,
		"FixtureReasonUnresolved": FixtureReasonUnresolved,
	} {
		if !reasonPattern.MatchString(fixture) {
			t.Errorf("%s = %q does not match the \"<scope> scenario: <phrase>\" shape Resolve expects", name, fixture)
		}
	}
}

func readFixtureSource(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}
