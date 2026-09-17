package export

import (
	"context"
	"testing"

	"dagger/tk-evidence-exporter/internal/evidence"
)

func samplePackage() evidence.Package {
	detail := "CAP_REJECTED fact=area51:site4:black-budget-vault-access vault=site4.internal: supervisor explicitly rejected this request"
	size := int64(7)
	return evidence.Package{
		SchemaVersion: evidence.SchemaVersion,
		Execution: evidence.ExecutionIdentity{
			SourceRevision:     "abc123",
			WorkflowRunID:      "42",
			WorkflowRunAttempt: "1",
			RunURL:             "https://github.com/null-hype/agent-plugins/actions/runs/42",
			JobName:            "test-scenarios",
			StepRefs:           []string{"Set up job (success)", `Testing "quoted" \ scenarios (success)`},
			ScenarioName:       "restic-backup",
		},
		Scenario: evidence.ScenarioResult{
			ScenarioName: "restic-backup",
			Outcome:      evidence.OutcomePassed,
			Checks: []evidence.CheckResult{
				{Label: "the truth is out there", Outcome: evidence.OutcomeFailed, Detail: &detail},
			},
		},
		Snapshots: []evidence.SnapshotRef{
			{ID: "d543a8f0...", ShortID: "d543a8f0", Tag: "restic-backup", TakenAt: "2026-09-17T00:03:36Z"},
			{ID: "bcdd5068...", ShortID: "bcdd5068", Tag: "restic-backup", TakenAt: "2026-09-17T00:03:37Z"},
		},
		FileTree: []evidence.FileTreeEntry{
			{Path: "/root/.claude", Type: "dir"},
			{Path: "/root/.claude/projects/session-b.jsonl", Type: "file", Size: &size},
		},
		Diff: []evidence.DiffEntry{
			{Path: "/root/.claude/projects/session-b.jsonl", ChangeType: "added"},
		},
		Logs: []evidence.LogExcerpt{
			{Source: "pkl test", Content: "line one\nline two with a \"quote\" and a \\ backslash"},
		},
		Validation: evidence.ValidationResult{
			SchemaVersion:     evidence.SchemaVersion,
			ArtifactHashes:    map[string]string{"restic-snapshots.json": "deadbeef"},
			StructurallyValid: true,
		},
	}
}

func TestEvaluateRoundTrip(t *testing.T) {
	pkg := samplePackage()
	got, err := Evaluate(context.Background(), pkg)
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}

	if got.Execution.SourceRevision != pkg.Execution.SourceRevision {
		t.Errorf("sourceRevision: got %q want %q", got.Execution.SourceRevision, pkg.Execution.SourceRevision)
	}
	// Regression check: pkl-go silently zeroes a defined (non-alias) Go
	// string type when decoding a Pkl typealias-of-string-literals value
	// (see evidence.Outcome's doc comment) -- this must round-trip as the
	// real "passed"/"failed" string, never "".
	if got.Scenario.Outcome != evidence.OutcomePassed {
		t.Errorf("scenario.outcome: got %q want %q", got.Scenario.Outcome, evidence.OutcomePassed)
	}
	if got.Scenario.Checks[0].Outcome != evidence.OutcomeFailed {
		t.Errorf("checks[0].outcome: got %q want %q", got.Scenario.Checks[0].Outcome, evidence.OutcomeFailed)
	}
	if len(got.Execution.StepRefs) != 2 || got.Execution.StepRefs[1] != pkg.Execution.StepRefs[1] {
		t.Errorf("stepRefs did not round-trip: got %v", got.Execution.StepRefs)
	}
	if len(got.Scenario.Checks) != 1 || got.Scenario.Checks[0].Detail == nil || *got.Scenario.Checks[0].Detail != *pkg.Scenario.Checks[0].Detail {
		t.Errorf("checks[0].detail did not round-trip: got %+v", got.Scenario.Checks)
	}
	if len(got.Snapshots) != 2 {
		t.Errorf("expected 2 snapshots, got %d", len(got.Snapshots))
	}
	if len(got.FileTree) != 2 || got.FileTree[1].Size == nil || *got.FileTree[1].Size != 7 {
		t.Errorf("fileTree did not round-trip: got %+v", got.FileTree)
	}
	if len(got.Logs) != 1 || got.Logs[0].Content != pkg.Logs[0].Content {
		t.Errorf("logs did not round-trip: got %+v", got.Logs)
	}
	if got.Validation.ArtifactHashes["restic-snapshots.json"] != "deadbeef" {
		t.Errorf("artifactHashes did not round-trip: got %+v", got.Validation.ArtifactHashes)
	}
}

func TestEvaluateRejectsInvalidOutcome(t *testing.T) {
	pkg := samplePackage()
	pkg.Scenario.Outcome = evidence.Outcome("bogus")
	if _, err := Evaluate(context.Background(), pkg); err == nil {
		t.Fatal("expected Evaluate to reject an invalid outcome value, got nil error")
	}
}

func TestCapabilityFactsFromChecks(t *testing.T) {
	rejected := "CAP_REJECTED fact=area51:site4:black-budget-vault-access vault=site4.internal: supervisor explicitly rejected this request"
	evalErr := "cannotFindModule: something else"
	facts := CapabilityFactsFromChecks([]evidence.CheckResult{
		{Label: "passing", Outcome: evidence.OutcomePassed},
		{Label: "rejected", Outcome: evidence.OutcomeFailed, Detail: &rejected},
		{Label: "broken", Outcome: evidence.OutcomeEvalError, Detail: &evalErr},
	})
	if len(facts) != 1 {
		t.Fatalf("expected 1 capability fact, got %d: %+v", len(facts), facts)
	}
	if facts[0].FactID != "area51:site4:black-budget-vault-access" || facts[0].Code != "CAP_REJECTED" {
		t.Errorf("unexpected fact: %+v", facts[0])
	}
}

func TestDiagnoseScenarioNameMismatch(t *testing.T) {
	pkg := samplePackage()
	pkg.Scenario.ScenarioName = "some-other-name"
	warnings := Diagnose(pkg)
	if !containsSubstring(warnings, "does not match scenario.scenarioName") {
		t.Errorf("expected a scenario-name mismatch warning, got %v", warnings)
	}
}

func TestDiagnoseNoSnapshots(t *testing.T) {
	pkg := samplePackage()
	pkg.Snapshots = nil
	pkg.Diff = nil
	warnings := Diagnose(pkg)
	if !containsSubstring(warnings, "no restic snapshots were captured") {
		t.Errorf("expected a no-snapshots warning, got %v", warnings)
	}
}

func TestDiagnoseCleanPackageHasNoWarnings(t *testing.T) {
	pkg := samplePackage()
	if warnings := Diagnose(pkg); len(warnings) != 0 {
		t.Errorf("expected no warnings for a consistent package, got %v", warnings)
	}
}

func containsSubstring(items []string, substr string) bool {
	for _, s := range items {
		if len(s) >= len(substr) {
			for i := 0; i+len(substr) <= len(s); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
		}
	}
	return false
}
