// Package export assembles an evidence.Package, renders it as a Pkl
// instance amending the embedded Evidence.pkl schema, and evaluates that
// instance through a real pkl-go evaluator -- the same generate-then-
// evaluate pattern capability-spike/supervisor/state.go uses for
// GrantState.pkl, but validating against an explicit schema class instead of
// relying on structural shape alone.
package export

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"github.com/apple/pkl-go/pkl"

	"dagger/tk-evidence-exporter/internal/evidence"
	"dagger/tk-evidence-exporter/internal/pkljunit"
	pklschema "dagger/tk-evidence-exporter/pkl"
)

// Hash returns the lowercase hex sha256 digest of data, for
// ValidationResult.ArtifactHashes entries.
func Hash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type evaluated struct {
	Result evidence.Package `pkl:"result"`
}

// Evaluate writes the embedded Evidence.pkl schema plus a generated
// instance module into a scratch directory and evaluates the instance
// through pkl-go. A structurally invalid pkg (a bad Outcome value, a missing
// required field, etc.) surfaces here as an error from the Pkl evaluator
// itself, not from Go-side validation logic that could drift from the
// schema.
func Evaluate(ctx context.Context, pkg evidence.Package) (evidence.Package, error) {
	dir, err := os.MkdirTemp("", "tk-evidence-exporter-*")
	if err != nil {
		return evidence.Package{}, fmt.Errorf("export: creating scratch dir: %w", err)
	}
	defer os.RemoveAll(dir)

	schemaPath := filepath.Join(dir, "Evidence.pkl")
	if err := os.WriteFile(schemaPath, pklschema.EvidencePkl, 0o644); err != nil {
		return evidence.Package{}, fmt.Errorf("export: writing schema: %w", err)
	}

	instancePath := filepath.Join(dir, "instance.pkl")
	if err := os.WriteFile(instancePath, []byte(renderInstance(pkg)), 0o644); err != nil {
		return evidence.Package{}, fmt.Errorf("export: writing instance: %w", err)
	}

	evaluator, err := pkl.NewEvaluator(ctx, pkl.PreconfiguredOptions)
	if err != nil {
		return evidence.Package{}, fmt.Errorf("export: starting pkl evaluator: %w", err)
	}
	defer evaluator.Close()

	var out evaluated
	if err := evaluator.EvaluateModule(ctx, pkl.FileSource(instancePath), &out); err != nil {
		return evidence.Package{}, fmt.Errorf("export: package failed Pkl validation: %w", err)
	}
	return out.Result, nil
}

// CapabilityFactsFromChecks extracts the structured CAP_* diagnostic fields
// out of any checks that carry one (see pkljunit.ParseDiagnostic), so a
// capability-spike scenario's `pkl test --junit-reports` output becomes real
// CapabilityFact evidence without needing a separate capture step. Checks
// with no CAP_* diagnostic (passes, or genuine eval-errors) are skipped.
func CapabilityFactsFromChecks(checks []evidence.CheckResult) []evidence.CapabilityFact {
	var facts []evidence.CapabilityFact
	for _, c := range checks {
		if c.Detail == nil {
			continue
		}
		code, factID, vault, message, ok := pkljunit.ParseDiagnostic(*c.Detail)
		if !ok {
			continue
		}
		facts = append(facts, evidence.CapabilityFact{
			FactID:   factID,
			Severity: "error",
			Code:     code,
			Vault:    vault,
			Message:  message,
		})
	}
	return facts
}

// Diagnose runs cross-field consistency checks the Pkl schema's types alone
// can't express (it validates shape and enum membership, not "these two
// strings should match"). Findings are returned as actionable warning
// strings, per the issue's ask for "actionable export diagnostics for
// incomplete or inconsistent evidence" -- callers decide whether to treat
// any of these as fatal.
func Diagnose(pkg evidence.Package) []string {
	var warnings []string

	if pkg.Execution.ScenarioName != pkg.Scenario.ScenarioName {
		warnings = append(warnings, fmt.Sprintf(
			"execution.scenarioName %q does not match scenario.scenarioName %q -- the scenario name must be used consistently across the feature test, assignment, snapshot tag, and lesson identity",
			pkg.Execution.ScenarioName, pkg.Scenario.ScenarioName))
	}

	if len(pkg.Snapshots) == 0 {
		warnings = append(warnings, "no restic snapshots were captured for this run -- the file tree and diff view will be empty")
	}
	for _, s := range pkg.Snapshots {
		if s.Tag != pkg.Execution.ScenarioName {
			warnings = append(warnings, fmt.Sprintf(
				"snapshot %s is tagged %q, which does not match the scenario name %q",
				s.ShortID, s.Tag, pkg.Execution.ScenarioName))
		}
	}

	if len(pkg.Snapshots) < 2 && len(pkg.Diff) > 0 {
		warnings = append(warnings, "a diff was captured but fewer than two snapshots are recorded -- diff provenance is unclear")
	}

	if pkg.Execution.SnapshotID != nil {
		found := false
		for _, s := range pkg.Snapshots {
			if s.ID == *pkg.Execution.SnapshotID {
				found = true
				break
			}
		}
		if !found {
			warnings = append(warnings, fmt.Sprintf(
				"execution.snapshotId %q (the snapshot this run produced) is not present in the snapshots listing", *pkg.Execution.SnapshotID))
		}
	} else if pkg.Scenario.Outcome == evidence.OutcomePassed && len(pkg.Snapshots) > 0 {
		warnings = append(warnings, "scenario passed and snapshots were captured, but execution.snapshotId is unset -- the file tree below cannot be bound to a specific run's own snapshot")
	}

	for _, e := range pkg.FileTree {
		if pkg.Execution.SnapshotID != nil && e.SnapshotID != *pkg.Execution.SnapshotID {
			warnings = append(warnings, fmt.Sprintf(
				"fileTree entry %q was listed from snapshot %q, which does not match execution.snapshotId %q",
				e.Path, e.SnapshotID, *pkg.Execution.SnapshotID))
			break // one representative warning is enough; every entry shares the same restic ls invocation
		}
	}

	if pkg.Scenario.Outcome == evidence.OutcomeFailed && len(pkg.Scenario.Checks) == 0 {
		warnings = append(warnings, "scenario outcome is failed but no per-check detail was captured -- this scenario has no structured test runner beneath it (see internal/ghactions's doc comment); only the job-level outcome is available")
	}

	return warnings
}
