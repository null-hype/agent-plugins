// Command tk-import turns one exported evidence.json (see cmd/export) into
// a static Tutorial Kit lesson directory: a content.mdx plus a `_files/`
// tree that TK mounts directly into its WebContainer editor and file tree
// at lesson load -- no live MCP bridge, no WebContainer runtime calls, no
// `tutorialStore` writes. See tk-evidence-exporter/README.md's "TK lesson
// import" section for why this is deliberately static rather than reusing
// null-hype.github.io#38's live retrospective-mcp bridge (that bridge needs
// a deployed VM plus a before/after snapshot *pair*; this package's real
// data is a single snapshot).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"dagger/tk-evidence-exporter/internal/evidence"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "tk-import:", err)
		os.Exit(1)
	}
}

func run() error {
	evidenceJSON := flag.String("evidence-json", "", "path to an evidence.json produced by cmd/export (required)")
	title := flag.String("title", "", "lesson title (default: \"Evidence: <scenarioName> (run <workflowRunId>)\")")
	out := flag.String("out", "", "output directory for the lesson (required) -- typically a lesson-N directory under a TK content tree")
	flag.Parse()

	if *evidenceJSON == "" {
		return fmt.Errorf("-evidence-json is required")
	}
	if *out == "" {
		return fmt.Errorf("-out is required")
	}

	data, err := os.ReadFile(*evidenceJSON)
	if err != nil {
		return fmt.Errorf("reading -evidence-json: %w", err)
	}
	var pkg evidence.Package
	if err := json.Unmarshal(data, &pkg); err != nil {
		return fmt.Errorf("decoding -evidence-json: %w", err)
	}

	files, err := buildLessonFiles(pkg, *title)
	if err != nil {
		return err
	}

	if err := writeFiles(*out, files); err != nil {
		return err
	}

	fmt.Printf("tk-import: wrote %d files to %s (scenario=%s outcome=%s)\n", len(files), *out, pkg.Scenario.ScenarioName, pkg.Scenario.Outcome)
	return nil
}

func writeFiles(outDir string, files map[string][]byte) error {
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, rel := range paths {
		full := filepath.Join(outDir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return fmt.Errorf("creating directory for %s: %w", rel, err)
		}
		if err := os.WriteFile(full, files[rel], 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", rel, err)
		}
	}
	return nil
}

// stepRefPattern splits a ghactions.StepRefs entry ("<step name> (<conclusion>)")
// back into its parts. A step whose conclusion GitHub hasn't recorded yet
// renders with empty parens ("Upload evidence package ()") -- see
// ghactions.StepRefs -- so the conclusion group allows empty.
var stepRefPattern = regexp.MustCompile(`^(.*) \(([a-zA-Z]*)\)$`)

// failingSteps returns every step whose recorded conclusion is neither
// "success" nor empty (in progress/not reached) -- i.e. a real failure,
// cancellation, or skip recorded by GitHub Actions itself for this job.
func failingSteps(stepRefs []string) []string {
	var failing []string
	for _, ref := range stepRefs {
		m := stepRefPattern.FindStringSubmatch(ref)
		if m == nil {
			continue
		}
		conclusion := m[2]
		if conclusion != "" && conclusion != "success" {
			failing = append(failing, ref)
		}
	}
	return failing
}

func jsonFile(v any) []byte {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		// Every value passed here is either decoded from this package's own
		// evidence.json or a plain map/slice built from it -- not
		// user-controlled, so a marshal failure here is a programming bug,
		// not a runtime condition to recover from.
		panic(fmt.Sprintf("tk-import: marshaling evidence subset: %v", err))
	}
	return data
}

func buildLessonFiles(pkg evidence.Package, title string) (map[string][]byte, error) {
	if pkg.Execution.ScenarioName == "" {
		return nil, fmt.Errorf("evidence.json has no execution.scenarioName")
	}
	if title == "" {
		title = fmt.Sprintf("Evidence: %s (run %s)", pkg.Execution.ScenarioName, pkg.Execution.WorkflowRunID)
	}

	files := map[string][]byte{
		"_files/evidence/execution.json":  jsonFile(pkg.Execution),
		"_files/evidence/scenario.json":   jsonFile(pkg.Scenario),
		"_files/evidence/snapshots.json":  jsonFile(pkg.Snapshots),
		"_files/evidence/file-tree.json":  jsonFile(pkg.FileTree),
		"_files/evidence/diff.json":       jsonFile(pkg.Diff),
		"_files/evidence/validation.json": jsonFile(pkg.Validation),
		"_files/evidence/capability.json": jsonFile(map[string]any{
			"facts":               pkg.CapabilityFacts,
			"grants":              pkg.CapabilityGrants,
			"observations":        pkg.CapabilityObservations,
			"reconciliationFlags": pkg.ReconciliationFlags,
		}),
	}

	readme, err := renderReadme(pkg)
	if err != nil {
		return nil, err
	}
	files["_files/evidence/README.md"] = readme
	files["content.mdx"] = renderContentMDX(pkg, title)
	return files, nil
}

func renderContentMDX(pkg evidence.Package, title string) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "---\n")
	fmt.Fprintf(&b, "type: lesson\n")
	fmt.Fprintf(&b, "title: %q\n", title)
	fmt.Fprintf(&b, "editor:\n  fileTree: true\n")
	fmt.Fprintf(&b, "focus: /evidence/README.md\n")
	fmt.Fprintf(&b, "terminal: false\n")
	fmt.Fprintf(&b, "previews: false\n")
	fmt.Fprintf(&b, "---\n\n")
	fmt.Fprintf(&b, "This lesson is generated, not authored: every file under **evidence/** is a\n")
	fmt.Fprintf(&b, "direct export of one real CI run, produced by [tk-evidence-exporter](%s)\n",
		"https://github.com/null-hype/agent-plugins/tree/main/tk-evidence-exporter")
	fmt.Fprintf(&b, "from [%s](%s), commit `%s`. Nothing here is a simulation or a scripted\n",
		fmt.Sprintf("run %s", pkg.Execution.WorkflowRunID), pkg.Execution.RunURL, shortSHA(pkg.Execution.SourceRevision))
	fmt.Fprintf(&b, "example.\n\n")

	fmt.Fprintf(&b, "## Recorded verdict\n\n")
	fmt.Fprintf(&b, "The **%s** scenario's own script recorded outcome **%s**.\n\n", pkg.Scenario.ScenarioName, pkg.Scenario.Outcome)

	if failing := failingSteps(pkg.Execution.StepRefs); len(failing) > 0 {
		fmt.Fprintf(&b, "This run's CI job itself did **not** finish cleanly -- %d step(s) recorded a\n", len(failing))
		fmt.Fprintf(&b, "non-success conclusion:\n\n")
		for _, s := range failing {
			fmt.Fprintf(&b, "- %s\n", s)
		}
		fmt.Fprintf(&b, "\nThese are two different granularities of outcome and must not be collapsed into\n")
		fmt.Fprintf(&b, "one: the scenario script's own recorded verdict above describes only the\n")
		fmt.Fprintf(&b, "**%s** scenario; the job-level failure above may come from a different\n", pkg.Scenario.ScenarioName)
		fmt.Fprintf(&b, "scenario or step entirely. See `evidence/execution.json`'s `stepRefs` for the\n")
		fmt.Fprintf(&b, "full list this run recorded.\n\n")
	} else {
		fmt.Fprintf(&b, "Every step GitHub Actions recorded a conclusion for in this job succeeded.\n\n")
	}

	fmt.Fprintf(&b, "## What's available, and what isn't\n\n")
	fmt.Fprintf(&b, "| Evidence | This run | File |\n")
	fmt.Fprintf(&b, "|---|---|---|\n")
	fmt.Fprintf(&b, "| Per-check breakdown | %s | `evidence/scenario.json` |\n", availability(len(pkg.Scenario.Checks), "%d check(s) captured", "not captured -- this scenario has no structured test runner beneath it (see README.md in tk-evidence-exporter)"))
	fmt.Fprintf(&b, "| Restic snapshot(s) | %s | `evidence/snapshots.json` |\n", availability(len(pkg.Snapshots), "%d snapshot(s)", "none recorded"))
	fmt.Fprintf(&b, "| Snapshot file-tree manifest | %s | `evidence/file-tree.json` |\n", availability(len(pkg.FileTree), "%d entries (paths and types only -- no file contents captured)", "not captured"))
	fmt.Fprintf(&b, "| Snapshot diff | %s | `evidence/diff.json` |\n", availability(len(pkg.Diff), "%d changed path(s)", "not captured -- this export has a single snapshot, not a before/after pair"))
	fmt.Fprintf(&b, "| Log excerpts | %s | (none exported) |\n", availability(len(pkg.Logs), "%d excerpt(s)", "not captured in this run"))
	fmt.Fprintf(&b, "| Capability facts/grants/observations | %s | `evidence/capability.json` |\n", availability(len(pkg.CapabilityFacts)+len(pkg.CapabilityGrants)+len(pkg.CapabilityObservations), "%d recorded", "not populated -- this export predates the capability-spike scenario (CIT-146) as an input"))
	fmt.Fprintf(&b, "\n")

	fmt.Fprintf(&b, "## Provenance and validation\n\n")
	fmt.Fprintf(&b, "The exporter's own package-validation verdict (`evidence/validation.json`) is\n")
	fmt.Fprintf(&b, "kept separate from the recorded scenario verdict above -- one says the package\n")
	fmt.Fprintf(&b, "is structurally well-formed, the other says what the scenario actually did.\n")
	if pkg.Validation.StructurallyValid {
		fmt.Fprintf(&b, "This package validated cleanly against schema version `%s`", pkg.Validation.SchemaVersion)
		if len(pkg.Validation.ValidationErrors) == 0 {
			fmt.Fprintf(&b, " with zero diagnostics.\n\n")
		} else {
			fmt.Fprintf(&b, ", but the exporter raised %d diagnostic(s) -- see below.\n\n", len(pkg.Validation.ValidationErrors))
			for _, w := range pkg.Validation.ValidationErrors {
				fmt.Fprintf(&b, "- %s\n", w)
			}
			fmt.Fprintf(&b, "\n")
		}
	} else {
		fmt.Fprintf(&b, "**This package failed the exporter's own structural validation.** Treat every\n")
		fmt.Fprintf(&b, "file under `evidence/` as unverified.\n\n")
	}

	fmt.Fprintf(&b, "Browse **evidence/README.md** (already open) and the files beside it in the\n")
	fmt.Fprintf(&b, "editor's file tree. Nothing in this lesson is interactive -- there is no\n")
	fmt.Fprintf(&b, "runtime to boot, no code to run, and no MCP tool to call. It is a static\n")
	fmt.Fprintf(&b, "browse-the-real-export experience, not a simulation.\n")

	return []byte(b.String())
}

func renderReadme(pkg evidence.Package) ([]byte, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "# Evidence: %s, run %s\n\n", pkg.Scenario.ScenarioName, pkg.Execution.WorkflowRunID)
	fmt.Fprintf(&b, "Source revision: `%s`\n\n", pkg.Execution.SourceRevision)
	fmt.Fprintf(&b, "Run: %s\n\n", pkg.Execution.RunURL)
	fmt.Fprintf(&b, "This directory is a direct export -- every file here is machine-generated from\n")
	fmt.Fprintf(&b, "the CI run above by tk-evidence-exporter's `cmd/export`, then repackaged for\n")
	fmt.Fprintf(&b, "this lesson by `cmd/tk-import`. Nothing has been hand-edited.\n\n")
	fmt.Fprintf(&b, "- `execution.json` -- which run, which job, which steps, and their conclusions.\n")
	fmt.Fprintf(&b, "- `scenario.json` -- the scenario script's own recorded verdict, plus any\n")
	fmt.Fprintf(&b, "  per-check breakdown (empty here -- see the lesson text for why).\n")
	fmt.Fprintf(&b, "- `snapshots.json` -- the restic snapshot(s) this run produced.\n")
	fmt.Fprintf(&b, "- `file-tree.json` -- a `restic ls` manifest of the snapshot: paths and types\n")
	fmt.Fprintf(&b, "  only. No file contents are captured or browsable here.\n")
	fmt.Fprintf(&b, "- `diff.json` -- changed paths between a snapshot pair, when one exists.\n")
	fmt.Fprintf(&b, "- `capability.json` -- capability-spike facts/grants/observations/\n")
	fmt.Fprintf(&b, "  reconciliation flags, when the exported run included that scenario.\n")
	fmt.Fprintf(&b, "- `validation.json` -- the exporter's own structural-validity verdict for\n")
	fmt.Fprintf(&b, "  this package, kept distinct from `scenario.json`'s recorded domain verdict.\n")
	return []byte(b.String()), nil
}

func availability(n int, presentFmt, absent string) string {
	if n == 0 {
		return absent
	}
	return fmt.Sprintf(presentFmt, n)
}

func shortSHA(sha string) string {
	if len(sha) > 12 {
		return sha[:12]
	}
	return sha
}
