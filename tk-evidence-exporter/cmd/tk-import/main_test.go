package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dagger/tk-evidence-exporter/internal/evidence"
)

// loadRealFixture decodes the real evidence.json downloaded from CI run
// 35172465388 (commit d9a581d, https://github.com/null-hype/agent-plugins/
// actions/runs/35172465388) -- not a synthetic/hand-built package. This is
// the repeatability proof: the same importer logic run against a real
// export, checked into testdata rather than only exercised live.
func loadRealFixture(t *testing.T) evidence.Package {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "evidence_real_run_d9a581d.json"))
	if err != nil {
		t.Fatalf("reading real fixture: %v", err)
	}
	var pkg evidence.Package
	if err := json.Unmarshal(data, &pkg); err != nil {
		t.Fatalf("decoding real fixture: %v", err)
	}
	return pkg
}

func TestBuildLessonFilesRealFixture(t *testing.T) {
	pkg := loadRealFixture(t)

	if pkg.Scenario.ScenarioName != "restic-backup" || pkg.Scenario.Outcome != evidence.OutcomePassed {
		t.Fatalf("fixture assumption changed: scenario=%+v", pkg.Scenario)
	}

	files, err := buildLessonFiles(pkg, "")
	if err != nil {
		t.Fatalf("buildLessonFiles: %v", err)
	}

	for _, want := range []string{
		"content.mdx",
		"_files/evidence/README.md",
		"_files/evidence/execution.json",
		"_files/evidence/scenario.json",
		"_files/evidence/snapshots.json",
		"_files/evidence/file-tree.json",
		"_files/evidence/diff.json",
		"_files/evidence/validation.json",
		"_files/evidence/capability.json",
	} {
		if _, ok := files[want]; !ok {
			t.Errorf("buildLessonFiles: missing %s", want)
		}
	}

	content := string(files["content.mdx"])

	// The real run's job had a failing step ("Testing all scenarios
	// (feature-local and global)") alongside a *passed* scenario verdict --
	// the lesson must surface both, not just the passed verdict.
	if !strings.Contains(content, "recorded outcome **passed**") {
		t.Errorf("content.mdx does not state the recorded passed verdict:\n%s", content)
	}
	if !strings.Contains(content, "did **not** finish cleanly") {
		t.Errorf("content.mdx does not surface the real job-level failure alongside the passed scenario verdict:\n%s", content)
	}
	if !strings.Contains(content, "Testing all scenarios (feature-local and global)") {
		t.Errorf("content.mdx does not name the failing step:\n%s", content)
	}

	// checks/diff/logs/capability are genuinely empty in this fixture --
	// the lesson must call that out as "not captured", never imply a clean
	// result.
	for _, marker := range []string{
		"not captured -- this scenario has no structured test runner",
		"not captured -- this export has a single snapshot",
		"not captured in this run",
		"not populated -- this export predates the capability-spike scenario",
	} {
		if !strings.Contains(content, marker) {
			t.Errorf("content.mdx missing availability marker %q:\n%s", marker, content)
		}
	}

	// fileTree has 16 real entries in this fixture -- must be reported as a
	// manifest (no contents), not silently glossed over.
	var fileTree []evidence.FileTreeEntry
	if err := json.Unmarshal(files["_files/evidence/file-tree.json"], &fileTree); err != nil {
		t.Fatalf("file-tree.json is not valid JSON: %v", err)
	}
	if len(fileTree) != 16 {
		t.Errorf("file-tree.json has %d entries, want 16 (fixture drifted?)", len(fileTree))
	}
	if !strings.Contains(content, "16 entries") {
		t.Errorf("content.mdx does not report the real file-tree entry count:\n%s", content)
	}

	if pkg.Validation.StructurallyValid && !strings.Contains(content, "validated cleanly") {
		t.Errorf("content.mdx does not report the exporter's own valid structural verdict:\n%s", content)
	}
}

func TestBuildLessonFilesEveryJSONFileParses(t *testing.T) {
	pkg := loadRealFixture(t)
	files, err := buildLessonFiles(pkg, "")
	if err != nil {
		t.Fatalf("buildLessonFiles: %v", err)
	}
	for path, data := range files {
		if !strings.HasSuffix(path, ".json") {
			continue
		}
		var v any
		if err := json.Unmarshal(data, &v); err != nil {
			t.Errorf("%s is not valid JSON: %v", path, err)
		}
	}
}

func TestBuildLessonFilesRequiresScenarioName(t *testing.T) {
	_, err := buildLessonFiles(evidence.Package{}, "")
	if err == nil {
		t.Fatal("expected an error for a package with no execution.scenarioName")
	}
}

func TestFailingStepsIgnoresSuccessAndInProgress(t *testing.T) {
	got := failingSteps([]string{
		"Set up job (success)",
		"Testing all scenarios (feature-local and global) (failure)",
		"Upload evidence package ()", // not yet concluded when this step ran
	})
	if len(got) != 1 || got[0] != "Testing all scenarios (feature-local and global) (failure)" {
		t.Errorf("failingSteps = %v, want exactly the one real failure", got)
	}
}

func TestWriteFilesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	files := map[string][]byte{
		"content.mdx":                    []byte("hello"),
		"_files/evidence/execution.json": []byte("{}"),
	}
	if err := writeFiles(dir, files); err != nil {
		t.Fatalf("writeFiles: %v", err)
	}
	for rel, want := range files {
		got, err := os.ReadFile(filepath.Join(dir, rel))
		if err != nil {
			t.Fatalf("reading back %s: %v", rel, err)
		}
		if string(got) != string(want) {
			t.Errorf("%s round-tripped as %q, want %q", rel, got, want)
		}
	}
}
