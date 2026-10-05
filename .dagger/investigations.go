package main

// CIT-320: Dagger checks that an investigation is consistent.
//
// A Question is asked and an answerer (a Jev judge, or the deterministic
// checker) investigates it. Each function here runs one investigation in a
// container and returns its report. InvestigationReport.Check then fails the
// call only when the investigation contradicts its own records, or could not
// collect an answer: an answer outside its expected range, or a Jev answer that
// disagrees with its deterministic evidence, is a row of the report, not a
// failure. The rules live in src/jev/pkl/Consistency.pkl; the facts are
// gathered by jev-playwright/consistency.mjs and
// tutorial-app/tests/rails-probes/rails-probes.consistency.spec.ts.
//
// This is jev-playwright's Run/RunReport.Check pattern (jev-playwright/dagger),
// lifted here so every Question set is checked the same way, in CI.

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const (
	nodeImage = "node:22.16.0-bookworm-slim"
	// The rails probes' pinned checker prints its summary in the format this
	// version uses (the committed reproduction records Pkl 0.32.1).
	railsProbesPklVersion = "0.32.1"
	// jev-playwright's own Dagger module pins this one; keep them the same.
	jevPklVersion = "0.26.3"
)

// InvestigationReport is what an investigation left behind, failures included.
type InvestigationReport struct {
	// Everything the run wrote; consistency.json holds the verdict.
	Artifacts *dagger.Directory
}

type consistencyVerdict struct {
	Consistent bool     `json:"consistent"`
	Broken     []string `json:"broken"`
}

// Check fails when the investigation is inconsistent or could not collect an
// answer, and otherwise returns its consistency.json, outcomes included.
func (r *InvestigationReport) Check(ctx context.Context) (string, error) {
	raw, err := r.Artifacts.File("consistency.json").Contents(ctx)
	if err != nil {
		errors, _ := r.Artifacts.File("errors.txt").Contents(ctx)
		return "", fmt.Errorf("the investigation produced no consistency verdict; export artifacts for the reports\n%s", errors)
	}
	var verdict consistencyVerdict
	if err := json.Unmarshal([]byte(raw), &verdict); err != nil {
		return "", fmt.Errorf("unreadable consistency.json: %w", err)
	}
	if !verdict.Consistent {
		return "", fmt.Errorf("the investigation is inconsistent:\n  %s", strings.Join(verdict.Broken, "\n  "))
	}
	return raw, nil
}

func pkl(c *dagger.Container, version string) *dagger.Container {
	return c.WithFile("/usr/local/bin/pkl",
		dag.HTTP("https://github.com/apple/pkl/releases/download/"+version+"/pkl-linux-amd64"),
		dagger.ContainerWithFileOpts{Permissions: 0755})
}

// RailsProbes asks the checker Questions of every pinned checker state (the
// rails probes, CIT-307/309), then checks the investigation agrees with itself.
// The consistency pass runs first, on the committed records and lessons; the
// probes then re-collect every answer and fail if any differs from the record.
func (m *AgentPlugins) RailsProbes(
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git"]
	source *dagger.Directory,
) *InvestigationReport {
	app := source.Directory("tutorial-app")
	c := pkl(dag.Container(dagger.ContainerOpts{Platform: "linux/amd64"}).From(nodeImage), railsProbesPklVersion).
		WithWorkdir("/workspace/tutorial-app").
		WithFile("package.json", app.File("package.json")).
		WithFile("package-lock.json", app.File("package-lock.json")).
		WithExec([]string{"npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"}).
		WithDirectory("/workspace/tutorial-app", app, dagger.ContainerWithDirectoryOpts{Exclude: []string{"node_modules"}}).
		WithDirectory("/workspace/src/jev/pkl", source.Directory("src/jev/pkl")).
		WithEnvVariable("RAILS_PROBES_NO_SERVERS", "1").
		WithEnvVariable("CI", "1").
		WithEnvVariable("CONSISTENCY_OUT", "/report").
		WithEnvVariable("CONSISTENCY_RUN_ID", "rails-probes").
		WithNewFile("/execute.mjs", `import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('/report', { recursive: true });
const run = (project) => spawnSync('npx', ['playwright', 'test', '--config=playwright.rails-probes.config.ts', '--project', project],
  { stdio: 'inherit' }).status ?? 1;
// The check, on the committed records, before anything rewrites them.
const consistency = run('consistency');
// The investigation itself: it fails only when an answer cannot be collected,
// or the re-collected answers differ from the committed reproduction.
const probes = run('probes');
writeFileSync('/report/exit-codes.json', JSON.stringify({ consistency, probes }));
if (!existsSync('/report/consistency.json')) {
  writeFileSync('/report/errors.txt', 'consistency exit ' + consistency + ', probes exit ' + probes + '\n');
} else if (probes !== 0) {
  const verdict = JSON.parse(readFileSync('/report/consistency.json', 'utf8'));
  verdict.consistent = false;
  verdict.broken.push('run: probes: the probes could not collect their answers, or they differ from the committed reproduction (exit ' + probes + ')');
  writeFileSync('/report/consistency.json', JSON.stringify(verdict, null, 2) + '\n');
}
`).
		WithExec([]string{"node", "/execute.mjs"})
	return &InvestigationReport{Artifacts: c.Directory("/report")}
}

// JevQuestions runs jev-playwright's Question graph (Jev judges), then checks
// the run agrees with itself. The mock backend answers from canned scores,
// labelled as such; the real one needs token.
func (m *AgentPlugins) JevQuestions(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "jev-playwright/runs", "**/__pycache__", "**/.env", ".git", "tutorial-app"]
	source *dagger.Directory,
	// A fresh ID per experiment: it is a Dagger cache input.
	// +default="ci"
	runId string,
	// +default="mock"
	backend string,
	// Required for backend=real; passed as a Dagger Secret.
	// +optional
	token *dagger.Secret,
	// Path relative to jev-playwright.
	// +default="fixtures/answers.json"
	mockAnswers string,
) (*InvestigationReport, error) {
	if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$`).MatchString(runId) {
		return nil, fmt.Errorf("invalid run ID")
	}
	if backend != "mock" && backend != "real" {
		return nil, fmt.Errorf("backend must be mock or real")
	}
	if backend == "real" && token == nil {
		return nil, fmt.Errorf("real backend requires token")
	}
	harness := source.Directory("jev-playwright")
	client := source.Directory("src/jev")
	reason := "goal=jev-playwright-v0; action=playwright-run; run=" + runId
	c := pkl(dag.Container(dagger.ContainerOpts{Platform: "linux/amd64"}).From(nodeImage), jevPklVersion).
		WithExec([]string{"sh", "-c", "apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*"}).
		WithExec([]string{"python3", "-m", "venv", "/opt/jev"}).
		WithExec([]string{"/opt/jev/bin/pip", "install", "--no-cache-dir", "pkl-python==0.1.19", "requests==2.32.3"}).
		WithWorkdir("/workspace/jev-playwright").
		WithFile("package.json", harness.File("package.json")).
		WithFile("package-lock.json", harness.File("package-lock.json")).
		WithExec([]string{"npm", "ci"}).
		WithDirectory("/workspace/jev-playwright", harness, dagger.ContainerWithDirectoryOpts{Include: []string{"*.mjs", "*.ts", "*.pcf", "pkl/**", "tests/**", "test/**", "watchmen/**", "fixtures/**"}}).
		WithFile("/workspace/src/jev/jev", client.File("jev")).
		WithFile("/workspace/src/jev/jev_pkl.py", client.File("jev_pkl.py")).
		WithDirectory("/workspace/src/jev/pkl", client.Directory("pkl")).
		WithEnvVariable("JEV_PYTHON", "/opt/jev/bin/python").
		WithEnvVariable("PROTON_PASS_AGENT_REASON", reason).
		WithEnvVariable("JEV_DAGGER_RUN_ID", runId).
		WithEnvVariable("JEV_DAGGER_BACKEND", backend).
		WithEnvVariable("JEV_DAGGER_ANSWERS", mockAnswers)
	if backend == "real" {
		c = c.WithSecretVariable("TYPESAFE_API_KEY", token)
	}
	// run.mjs exits non-zero when an answer misses its range; that is an answer,
	// not a failure, so only consistency.json decides the check.
	c = c.WithNewFile("/execute.mjs", `import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('/report', { recursive: true });
const args = ['run.mjs', '--backend', process.env.JEV_DAGGER_BACKEND,
 '--credentials', 'env', '--run-id', process.env.JEV_DAGGER_RUN_ID,
 '--output-dir', '/report', '--mock-answers', process.env.JEV_DAGGER_ANSWERS];
const result = spawnSync('node', args, { stdio: 'inherit' });
writeFileSync('/report/exit-code.json', JSON.stringify(result.status ?? 1));
// Watching the watchmen (watchmen.pcf): does the check notice tampered records?
// The answers are data under /report/watchmen; only one that could not be
// collected fails.
const watchmen = spawnSync('npx', ['playwright', 'test', '--config', 'playwright.watchmen.config.ts'],
 { stdio: 'inherit', env: { ...process.env, WATCHMEN_OUT: '/report/watchmen' } }).status ?? 1;
if (!existsSync('/report/consistency.json')) {
  writeFileSync('/report/errors.txt', 'run.mjs exit ' + (result.status ?? 1) + (result.error ? ': ' + result.error.message : '') + '\n');
} else if (watchmen !== 0) {
  const verdict = JSON.parse(readFileSync('/report/consistency.json', 'utf8'));
  verdict.consistent = false;
  verdict.broken.push('run: watchmen: a watchmen answer could not be collected (exit ' + watchmen + ')');
  writeFileSync('/report/consistency.json', JSON.stringify(verdict, null, 2) + '\n');
}
`).WithExec([]string{"node", "/execute.mjs"})
	return &InvestigationReport{Artifacts: c.Directory("/report")}, nil
}

// CheckRailsProbes: the checker investigation is consistent.
// +check
func (m *AgentPlugins) CheckRailsProbes(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "test-results", "**/dist", "**/storybook-static", ".git"]
	source *dagger.Directory,
) error {
	_, err := m.RailsProbes(source).Check(ctx)
	return err
}

// CheckJevQuestions: the Jev investigation, on canned answers, is consistent.
// +check
func (m *AgentPlugins) CheckJevQuestions(
	ctx context.Context,
	// +defaultPath="/"
	// +ignore=["**/node_modules", "**/.venv", "jev-playwright/runs", "**/__pycache__", "**/.env", ".git", "tutorial-app"]
	source *dagger.Directory,
) error {
	report, err := m.JevQuestions(ctx, source, "ci", "mock", nil, "fixtures/answers.json")
	if err != nil {
		return err
	}
	_, err = report.Check(ctx)
	return err
}
