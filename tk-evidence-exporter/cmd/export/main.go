// Command export turns one GitHub Actions feature-test run plus its restic
// snapshot JSON into a Pkl-validated evidence.Package, written as JSON to
// --out/evidence.json. See tk-evidence-exporter/README.md for the full
// input/output/invocation contract.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"dagger/tk-evidence-exporter/internal/evidence"
	"dagger/tk-evidence-exporter/internal/export"
	"dagger/tk-evidence-exporter/internal/ghactions"
	"dagger/tk-evidence-exporter/internal/pkljunit"
	"dagger/tk-evidence-exporter/internal/resticparse"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "export:", err)
		os.Exit(1)
	}
}

func run() error {
	repo := flag.String("repo", envOr("GITHUB_REPOSITORY", ""), "owner/repo (default: $GITHUB_REPOSITORY)")
	runID := flag.String("run-id", envOr("GITHUB_RUN_ID", ""), "workflow run ID (default: $GITHUB_RUN_ID)")
	runAttempt := flag.String("run-attempt", envOr("GITHUB_RUN_ATTEMPT", ""), "workflow run attempt (default: $GITHUB_RUN_ATTEMPT)")
	jobName := flag.String("job-name", envOr("GITHUB_JOB", ""), "job id as declared in the workflow YAML (default: $GITHUB_JOB)")
	serverURL := flag.String("server-url", envOr("GITHUB_SERVER_URL", "https://github.com"), "GitHub server URL (default: $GITHUB_SERVER_URL)")
	sha := flag.String("sha", envOr("GITHUB_SHA", ""), "source revision (default: $GITHUB_SHA)")
	token := flag.String("github-token", envOr("GITHUB_TOKEN", ""), "token for the Actions Jobs API (default: $GITHUB_TOKEN)")
	apiURL := flag.String("github-api-url", envOr("GITHUB_API_URL", "https://api.github.com"), "GitHub REST API base URL (default: $GITHUB_API_URL, for GitHub Enterprise or tests)")

	scenario := flag.String("scenario", "", "scenario name, used consistently for the feature/assignment/snapshot-tag/lesson identity (required)")
	snapshotsJSON := flag.String("snapshots-json", "", "path to `restic snapshots --tag <scenario> --json` output (required)")
	lsJSON := flag.String("ls-json", "", "path to `restic ls <snapshotID> --json` output (optional)")
	diffJSON := flag.String("diff-json", "", "path to `restic diff <id1> <id2> --json` output (optional, only when a snapshot pair exists)")
	junitDir := flag.String("junit-dir", "", "directory of `pkl test --junit-reports` XML files (optional; only for Pkl-test-backed scenarios)")
	out := flag.String("out", "build", "output directory for evidence.json")

	flag.Parse()

	if *scenario == "" {
		return fmt.Errorf("-scenario is required")
	}
	if *snapshotsJSON == "" {
		return fmt.Errorf("-snapshots-json is required")
	}
	if *repo == "" || *runID == "" {
		return fmt.Errorf("-repo and -run-id are required (directly or via $GITHUB_REPOSITORY/$GITHUB_RUN_ID)")
	}

	ctx := context.Background()
	pkg := evidence.Package{SchemaVersion: evidence.SchemaVersion}
	hashes := map[string]string{}

	client := ghactions.NewClient(*token)
	client.BaseURL = *apiURL
	jobs, err := client.JobsForRun(ctx, *repo, *runID)
	if err != nil {
		return fmt.Errorf("fetching job/step conclusions: %w", err)
	}
	job, found := ghactions.FindJob(jobs, *jobName)
	if !found {
		return fmt.Errorf("job %q not found among %d jobs for run %s -- pass -job-name explicitly if it differs from $GITHUB_JOB", *jobName, len(jobs), *runID)
	}

	pkg.Execution = evidence.ExecutionIdentity{
		SourceRevision:     *sha,
		WorkflowRunID:      *runID,
		WorkflowRunAttempt: *runAttempt,
		RunURL:             fmt.Sprintf("%s/%s/actions/runs/%s", *serverURL, *repo, *runID),
		JobName:            job.Name,
		StepRefs:           ghactions.StepRefs(job.Steps),
		ScenarioName:       *scenario,
	}

	pkg.Scenario = evidence.ScenarioResult{
		ScenarioName: *scenario,
		Outcome:      ghactions.Outcome(job.Conclusion),
	}

	snapshotsData, err := os.ReadFile(*snapshotsJSON)
	if err != nil {
		return fmt.Errorf("reading -snapshots-json: %w", err)
	}
	hashes[filepath.Base(*snapshotsJSON)] = export.Hash(snapshotsData)
	pkg.Snapshots, err = resticparse.ParseSnapshots(snapshotsData)
	if err != nil {
		return err
	}

	if *lsJSON != "" {
		data, err := os.ReadFile(*lsJSON)
		if err != nil {
			return fmt.Errorf("reading -ls-json: %w", err)
		}
		hashes[filepath.Base(*lsJSON)] = export.Hash(data)
		pkg.FileTree, err = resticparse.ParseLS(data)
		if err != nil {
			return err
		}
	}

	if *diffJSON != "" {
		data, err := os.ReadFile(*diffJSON)
		if err != nil {
			return fmt.Errorf("reading -diff-json: %w", err)
		}
		hashes[filepath.Base(*diffJSON)] = export.Hash(data)
		pkg.Diff, err = resticparse.ParseDiff(data)
		if err != nil {
			return err
		}
	}

	if *junitDir != "" {
		entries, err := os.ReadDir(*junitDir)
		if err != nil {
			return fmt.Errorf("reading -junit-dir: %w", err)
		}
		for _, e := range entries {
			if e.IsDir() || filepath.Ext(e.Name()) != ".xml" {
				continue
			}
			path := filepath.Join(*junitDir, e.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading %s: %w", path, err)
			}
			hashes[e.Name()] = export.Hash(data)
			checks, err := pkljunit.Parse(data)
			if err != nil {
				return fmt.Errorf("parsing %s: %w", path, err)
			}
			pkg.Scenario.Checks = append(pkg.Scenario.Checks, checks...)
		}
		pkg.CapabilityFacts = export.CapabilityFactsFromChecks(pkg.Scenario.Checks)
	}

	warnings := export.Diagnose(pkg)
	for _, w := range warnings {
		fmt.Fprintln(os.Stderr, "export: diagnostic:", w)
	}

	pkg.Validation = evidence.ValidationResult{
		SchemaVersion:     evidence.SchemaVersion,
		ArtifactHashes:    hashes,
		StructurallyValid: false, // set true below only if Pkl evaluation actually succeeds
		ValidationErrors:  warnings,
	}

	validated, err := export.Evaluate(ctx, pkg)
	if err != nil {
		return fmt.Errorf("package failed Pkl validation: %w", err)
	}
	validated.Validation.StructurallyValid = true
	validated.Validation.ValidationErrors = warnings

	if err := os.MkdirAll(*out, 0o755); err != nil {
		return fmt.Errorf("creating -out directory: %w", err)
	}
	outPath := filepath.Join(*out, "evidence.json")
	data, err := json.MarshalIndent(validated, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling evidence.json: %w", err)
	}
	if err := os.WriteFile(outPath, data, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", outPath, err)
	}

	fmt.Printf("export: wrote %s (scenario=%s outcome=%s snapshots=%d warnings=%d)\n",
		outPath, validated.Scenario.ScenarioName, validated.Scenario.Outcome, len(validated.Snapshots), len(warnings))
	return nil
}
