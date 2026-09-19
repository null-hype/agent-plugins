package pkljunit

import (
	"os"
	"strings"
	"testing"

	"dagger/tk-evidence-exporter/internal/evidence"
)

// All fixtures here are real `pkl test --junit-reports` output captured
// against capability-spike's actual worker/*.pkl fact files (see
// tk-evidence-exporter's plan notes) -- not hand-authored XML.

func mustParse(t *testing.T, path string) []evidence.CheckResult {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	results, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse(%s): %v", path, err)
	}
	if len(results) != 1 {
		t.Fatalf("Parse(%s): expected 1 result, got %d", path, len(results))
	}
	return results
}

func TestParsePassed(t *testing.T) {
	results := mustParse(t, "testdata/passed.xml")
	if results[0].Outcome != evidence.OutcomePassed {
		t.Errorf("outcome = %q, want passed", results[0].Outcome)
	}
	if results[0].Detail != nil {
		t.Errorf("expected nil detail for a pass, got %q", *results[0].Detail)
	}
	if results[0].Label != "flight_booking_area51.facts/the truth is out there" {
		t.Errorf("unexpected label: %q", results[0].Label)
	}
}

func TestParseCapRejectedIsFailedNotEvalError(t *testing.T) {
	results := mustParse(t, "testdata/rejected.xml")
	if results[0].Outcome != evidence.OutcomeFailed {
		t.Errorf("outcome = %q, want failed (a CAP_REJECTED denial is a domain verdict, not an eval error)", results[0].Outcome)
	}
	if results[0].Detail == nil || !strings.HasPrefix(*results[0].Detail, "CAP_REJECTED") {
		t.Errorf("expected detail to start with CAP_REJECTED, got %v", results[0].Detail)
	}
}

func TestParseCapNoGrantIsFailed(t *testing.T) {
	results := mustParse(t, "testdata/no_grant.xml")
	if results[0].Outcome != evidence.OutcomeFailed {
		t.Errorf("outcome = %q, want failed", results[0].Outcome)
	}
	if results[0].Detail == nil || !strings.HasPrefix(*results[0].Detail, "CAP_NO_GRANT") {
		t.Errorf("expected detail to start with CAP_NO_GRANT, got %v", results[0].Detail)
	}
}

func TestParseCapVaultMismatchIsFailed(t *testing.T) {
	results := mustParse(t, "testdata/vault_mismatch.xml")
	if results[0].Outcome != evidence.OutcomeFailed {
		t.Errorf("outcome = %q, want failed", results[0].Outcome)
	}
	if results[0].Detail == nil || !strings.HasPrefix(*results[0].Detail, "CAP_VAULT_MISMATCH") {
		t.Errorf("expected detail to start with CAP_VAULT_MISMATCH, got %v", results[0].Detail)
	}
}

func TestParseDiagnostic(t *testing.T) {
	code, factID, vault, message, ok := ParseDiagnostic(
		"CAP_REJECTED fact=area51:site4:black-budget-vault-access vault=site4.internal: supervisor explicitly rejected this request")
	if !ok {
		t.Fatal("expected ok=true for a well-formed CAP_* diagnostic")
	}
	if code != "CAP_REJECTED" {
		t.Errorf("code = %q", code)
	}
	if factID != "area51:site4:black-budget-vault-access" {
		t.Errorf("factID = %q", factID)
	}
	if vault != "site4.internal" {
		t.Errorf("vault = %q", vault)
	}
	if message != "supervisor explicitly rejected this request" {
		t.Errorf("message = %q", message)
	}

	if _, _, _, _, ok := ParseDiagnostic("cannotFindModule: something else entirely"); ok {
		t.Error("expected ok=false for a non-CAP_* detail string")
	}
}

func TestParseGenuineEvalErrorIsNotFailed(t *testing.T) {
	// Captured before GrantState.pkl existed: a real cannotFindModule error,
	// not a CAP_* domain denial. Must not be misclassified as "failed".
	results := mustParse(t, "testdata/genuine_eval_error.xml")
	if results[0].Outcome != evidence.OutcomeEvalError {
		t.Errorf("outcome = %q, want eval-error", results[0].Outcome)
	}
	if results[0].Detail == nil || !strings.Contains(*results[0].Detail, "cannotFindModule") {
		t.Errorf("expected detail to mention cannotFindModule, got %v", results[0].Detail)
	}
}
