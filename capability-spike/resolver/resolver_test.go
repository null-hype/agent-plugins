package resolver

import (
	"testing"

	"dagger/capability-spike/diagnostic"
	"dagger/capability-spike/supervisor"
)

// testVocabulary mirrors pkl/GovernedVocabulary.pkl's real, committed
// `admitted` listing -- these tests exercise Resolve as pure Go so they
// run without a `pkl` binary on PATH (LoadVocabulary, which does need one,
// is exercised separately and is not what this package's logic depends
// on to be correct).
func testVocabulary() GovernedVocabulary {
	return GovernedVocabulary{
		RequiresVocabularyAdmission: true,
		Admitted: []*AdmittedTerm{
			{
				Phrase:   "planting codeword in a fresh session",
				FactID:   "pass-cli:color:resume:plant-codeword",
				Scope:    "jin-91-resume-session",
				LossAxes: []string{"session-lifecycle-detail", "verb-tense"},
			},
			{
				Phrase:   "resuming restored session to read back the codeword",
				FactID:   "pass-cli:color:resume:read-codeword",
				Scope:    "jin-91-resume-session",
				LossAxes: []string{"session-lifecycle-detail", "restoration-provenance"},
			},
		},
	}
}

func TestResolve_AdmittedButNoGrant_IsDistinctFromUnresolved(t *testing.T) {
	vocab := testVocabulary()
	noGrants := map[string]*supervisor.Grant{}

	got := Resolve(FixtureReason, vocab, noGrants)

	if got.Raw != FixtureReason {
		t.Errorf("raw statement did not survive: got %q, want %q", got.Raw, FixtureReason)
	}
	if got.ResolvedFactID == nil || *got.ResolvedFactID != "pass-cli:color:resume:plant-codeword" {
		t.Fatalf("expected admission to resolve a factID, got %v", got.ResolvedFactID)
	}
	if len(got.LossAxes) == 0 {
		t.Error("expected loss axes to be carried alongside the resolved factID")
	}
	if got.Diagnostic == nil {
		t.Fatal("expected a diagnostic: admission does not confer access")
	}
	if got.Diagnostic.Code != "CAP_NO_GRANT" {
		t.Errorf("code = %q, want CAP_NO_GRANT", got.Diagnostic.Code)
	}
	if got.Diagnostic.Severity != diagnostic.SeverityError || got.Diagnostic.Message == "" {
		t.Errorf("expected a real Diagnostic{severity, code, message}, got %+v", got.Diagnostic)
	}
}

func TestResolve_UnadmittedPhrase_IsUnresolvedNotNoGrant(t *testing.T) {
	vocab := testVocabulary()
	// A grant for the *fact* an admitted phrase would have mapped to
	// exists here, but the phrase this reason carries was never admitted
	// in the first place, so there is nothing to look a grant up by.
	grants := map[string]*supervisor.Grant{
		"pass-cli:color:resume:plant-codeword": {FactID: "pass-cli:color:resume:plant-codeword", Vault: "jin-91-resume-session", Approved: true},
	}

	got := Resolve(FixtureReasonUnresolved, vocab, grants)

	if got.Raw != FixtureReasonUnresolved {
		t.Errorf("raw statement did not survive: got %q, want %q", got.Raw, FixtureReasonUnresolved)
	}
	if got.ResolvedFactID != nil {
		t.Errorf("expected no resolved factID for an unadmitted phrase, got %v", *got.ResolvedFactID)
	}
	if got.Diagnostic == nil || got.Diagnostic.Code != diagnostic.CodeTermUnresolved {
		t.Fatalf("expected CAP_TERM_UNRESOLVED, got %+v", got.Diagnostic)
	}
	if got.Diagnostic.Code == "CAP_NO_GRANT" {
		t.Error("an unadmitted phrase must not report the same code as an admitted-but-ungranted one")
	}
}

func TestResolve_AdmittedAndGranted_ResolvesClean(t *testing.T) {
	vocab := testVocabulary()
	grants := map[string]*supervisor.Grant{
		"pass-cli:color:resume:read-codeword": {FactID: "pass-cli:color:resume:read-codeword", Vault: "jin-91-resume-session", Approved: true},
	}

	got := Resolve(FixtureReasonGranted, vocab, grants)

	if got.Diagnostic != nil {
		t.Errorf("expected a clean resolution, got diagnostic %+v", got.Diagnostic)
	}
	if got.ResolvedFactID == nil || *got.ResolvedFactID != "pass-cli:color:resume:read-codeword" {
		t.Fatalf("expected the granted factID to resolve, got %v", got.ResolvedFactID)
	}
}

func TestResolve_RejectedGrant(t *testing.T) {
	vocab := testVocabulary()
	grants := map[string]*supervisor.Grant{
		"pass-cli:color:resume:plant-codeword": {FactID: "pass-cli:color:resume:plant-codeword", Vault: "jin-91-resume-session", Approved: false},
	}

	got := Resolve(FixtureReason, vocab, grants)

	if got.Diagnostic == nil || got.Diagnostic.Code != "CAP_REJECTED" {
		t.Fatalf("expected CAP_REJECTED, got %+v", got.Diagnostic)
	}
}

func TestResolve_DroppedScopeNeverPasses(t *testing.T) {
	vocab := testVocabulary()
	// A grant exists for the right factID, approved for a *different*
	// scope/vault than the one this reason actually carries -- the scope
	// qualifier in the raw reason must be checked, not dropped, so this
	// must not resolve clean just because some grant for the same
	// factID happens to exist.
	grants := map[string]*supervisor.Grant{
		"pass-cli:color:resume:plant-codeword": {FactID: "pass-cli:color:resume:plant-codeword", Vault: "some-other-scope", Approved: true},
	}

	got := Resolve(FixtureReason, vocab, grants)

	if got.Diagnostic == nil {
		t.Fatal("a mismatched scope must never produce a pass")
	}
	if got.Diagnostic.Code != "CAP_VAULT_MISMATCH" {
		t.Errorf("code = %q, want CAP_VAULT_MISMATCH", got.Diagnostic.Code)
	}
}

func TestResolve_MalformedReasonIsUnresolved(t *testing.T) {
	vocab := testVocabulary()

	got := Resolve("not a governed reason string", vocab, nil)

	if got.Raw != "not a governed reason string" {
		t.Errorf("raw statement did not survive: got %q", got.Raw)
	}
	if got.ResolvedFactID != nil {
		t.Error("expected no resolved factID for a malformed reason")
	}
	if got.Diagnostic == nil || got.Diagnostic.Code != diagnostic.CodeTermUnresolved {
		t.Fatalf("expected CAP_TERM_UNRESOLVED for a malformed reason, got %+v", got.Diagnostic)
	}
}
