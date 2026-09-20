package main

import (
	"os"
	"path/filepath"
	"testing"

	"dagger/tk-evidence-exporter/internal/evidence"
)

func TestResolveScenarioOutcomeNoPathIsEvalError(t *testing.T) {
	// CIT-147 (bounded correction): omitting -scenario-outcome-json must
	// surface as an explicit evidence.OutcomeEvalError, not a guess derived
	// from this run's own (possibly unrelated, possibly not-yet-final) job
	// conclusion -- see resolveScenarioOutcome's doc comment.
	got, err := resolveScenarioOutcome("")
	if err != nil {
		t.Fatalf("resolveScenarioOutcome(\"\"): unexpected error: %v", err)
	}
	if got != evidence.OutcomeEvalError {
		t.Errorf("resolveScenarioOutcome(\"\") = %q, want %q", got, evidence.OutcomeEvalError)
	}
}

func TestResolveScenarioOutcomeFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "scenario-outcome.json")
	if err := os.WriteFile(path, []byte(`{"outcome": "failed"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := resolveScenarioOutcome(path)
	if err != nil {
		t.Fatalf("resolveScenarioOutcome: unexpected error: %v", err)
	}
	if got != evidence.OutcomeFailed {
		t.Errorf("resolveScenarioOutcome = %q, want %q", got, evidence.OutcomeFailed)
	}
}

func TestResolveScenarioOutcomeRejectsUnrecognizedValue(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "scenario-outcome.json")
	if err := os.WriteFile(path, []byte(`{"outcome": "sideways"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveScenarioOutcome(path); err == nil {
		t.Fatal("expected an error for an unrecognized outcome value, got nil")
	}
}

func TestArtifactHashesSortedByPath(t *testing.T) {
	got := artifactHashes(map[string]string{
		"restic-snapshots.json": "aaa",
		"restic-ls.json":        "bbb",
	})
	if len(got) != 2 || got[0].Path != "restic-ls.json" || got[1].Path != "restic-snapshots.json" {
		t.Errorf("artifactHashes not sorted by path: %+v", got)
	}
}

func TestArtifactHashesEmptyIsNotNil(t *testing.T) {
	got := artifactHashes(map[string]string{})
	if got == nil {
		t.Error("artifactHashes(empty map) returned nil, want a non-nil empty slice (see evidence.Package.Normalize's doc comment)")
	}
}
