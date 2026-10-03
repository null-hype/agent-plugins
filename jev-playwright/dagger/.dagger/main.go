// Execute the complete Pkl-defined Playwright question graph and reconciliation.
package main

import (
	"context"
	"dagger/jev-playwright/internal/dagger"
	"fmt"
	"regexp"
	"strings"
)

type JevPlaywright struct{}

// Reason defines the run-level purpose, before host pass-cli resolves a secret.
func (m *JevPlaywright) Reason(runId string) (string, error) {
	if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$`).MatchString(runId) {
		return "", fmt.Errorf("invalid run ID")
	}
	return "goal=jev-playwright-v0; action=playwright-run; run=" + runId, nil
}

// Run owns the whole execution: Pkl evaluation, Playwright projects, Jev,
// reporter, and final Pkl reconciliation. Use a fresh runId for each experiment.
func (m *JevPlaywright) Run(
	// Harness source (the jev-playwright directory).
	// +ignore=["node_modules", ".venv", "runs", "dagger", ".env"]
	harness *dagger.Directory,
	// Existing Jev client source (the src/jev directory).
	// +ignore=["__pycache__", ".venv", ".env"]
	client *dagger.Directory,
	runId string,
	// +default="mock"
	backend string,
	// Required for backend=real; passed as a Dagger Secret.
	// +optional
	token *dagger.Secret,
	// Path relative to the harness directory.
	// +default="fixtures/answers.json"
	mockAnswers string,
) (*RunReport, error) {
	reason, err := m.Reason(runId)
	if err != nil {
		return nil, err
	}
	if backend != "mock" && backend != "real" {
		return nil, fmt.Errorf("backend must be mock or real")
	}
	if backend == "real" && token == nil {
		return nil, fmt.Errorf("real backend requires token")
	}
	c := dag.Container(dagger.ContainerOpts{Platform: "linux/amd64"}).
		From("node:22.16.0-bookworm-slim").
		WithExec([]string{"sh", "-c", "apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*"}).
		WithFile("/usr/local/bin/pkl", dag.HTTP("https://github.com/apple/pkl/releases/download/0.26.3/pkl-linux-amd64"), dagger.ContainerWithFileOpts{Permissions: 0755}).
		WithExec([]string{"python3", "-m", "venv", "/opt/jev"}).
		WithExec([]string{"/opt/jev/bin/pip", "install", "--no-cache-dir", "pkl-python==0.1.19", "requests==2.32.3"}).
		WithWorkdir("/workspace/jev-playwright").
		WithFile("package.json", harness.File("package.json")).
		WithFile("package-lock.json", harness.File("package-lock.json")).
		WithExec([]string{"npm", "ci"}).
		WithDirectory("/workspace/jev-playwright", harness, dagger.ContainerWithDirectoryOpts{Include: []string{"*.mjs", "*.ts", "report-expected.pcf", "pkl/**", "tests/**", "test/**", "fixtures/**"}}).
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
	// Preserve reports even when Playwright/reconciliation fails. Check propagates
	// the captured exit status; exporting Artifacts alone does not assert success.
	c = c.WithNewFile("/execute.mjs", `import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('/report', {recursive:true});
const args = ['run.mjs', '--backend', process.env.JEV_DAGGER_BACKEND,
 '--credentials', 'env', '--run-id', process.env.JEV_DAGGER_RUN_ID,
 '--output-dir', '/report', '--mock-answers', process.env.JEV_DAGGER_ANSWERS];
const result = spawnSync('node', args, {stdio:'inherit'});
writeFileSync('/report/exit-code.json', JSON.stringify(result.status ?? 1));
writeFileSync('/report/execution.json', JSON.stringify({
 executor:'dagger', runId:process.env.JEV_DAGGER_RUN_ID,
 reason:process.env.PROTON_PASS_AGENT_REASON, error:result.error?.message ?? null
}, null, 2));
`).WithExec([]string{"node", "/execute.mjs"})
	return &RunReport{Artifacts: c.Directory("/report")}, nil
}

type RunReport struct {
	Artifacts *dagger.Directory
}

// Check fails the Dagger call when the test harness failed.
func (r *RunReport) Check(ctx context.Context) (string, error) {
	code, err := r.Artifacts.File("exit-code.json").Contents(ctx)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(code) != "0" {
		return "", fmt.Errorf("Playwright experiment failed (exit %s); export artifacts for the reports", strings.TrimSpace(code))
	}
	return r.Artifacts.File("comparison.json").Contents(ctx)
}
