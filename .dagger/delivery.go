package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
)

// PeopleCanInstallJevLsp: people can install jev-lsp and see each answer on
// the line of the test that asked it (jev-playwright/delivery/goal.md).
//
// The delivery loop runs twice, as Playwright: once to Jules's approved plan
// (feature-plan), once to the files Jules wrote (feature). Each run, the
// priority reporter asks Jev what is still a priority for the goal and leaves
// each answer as a witness finding on the line of its test. After each run the
// check opens the spec in witness (github.com/null-hype/witness), as an editor
// would, and reads what it shows there. It passes when every answer shows on
// its test's line, none is stale, and between the two runs the work moved the
// priorities forward: some step cooled beyond noise, and none warmed beyond it.
//
// Each agent logs in to Pass with its own token. The repo's .env gives the
// tokens as defaults, env:// variables that pass-cli resolves from pass:// refs:
//
//	pass-cli run --env-file .env -- dagger check people-can-install-jev-lsp
//
// +check
func (m *AgentPlugins) PeopleCanInstallJevLsp(
	ctx context.Context,
	// +defaultPath="/jev-playwright"
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", "**/.witness"]
	harness *dagger.Directory,
	// The planner's Pass token: it reads the Jules key.
	// +optional
	plannerToken *dagger.Secret,
	// The judge's Pass token: it reads the Jev key.
	// +optional
	judgeToken *dagger.Secret,
) error {
	_, err := m.Delivery(harness, plannerToken, judgeToken).Sync(ctx)
	return err
}

// Delivery runs the delivery loop for the goal and leaves its reports in
// jev-playwright/delivery/test-results.
func (m *AgentPlugins) Delivery(
	// +defaultPath="/jev-playwright"
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", "**/.witness"]
	harness *dagger.Directory,
	// +optional
	plannerToken *dagger.Secret,
	// +optional
	judgeToken *dagger.Secret,
) *dagger.Container {
	witness := dag.Container().
		From("golang:1.22").
		WithDirectory("/src", dag.Git("https://github.com/null-hype/witness").Branch("main").Tree()).
		WithWorkdir("/src").
		WithEnvVariable("CGO_ENABLED", "0").
		WithExec([]string{"go", "build", "-o", "/witness", "."}).
		File("/witness")
	c := dag.Container().
		From("node:22-bookworm").
		WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq jq && curl -fsSL https://proton.me/download/pass-cli/install.sh | bash"}).
		WithFile("/usr/local/bin/witness", witness).
		WithEnvVariable("PATH", "/root/.local/bin:$PATH", dagger.ContainerWithEnvVariableOpts{Expand: true}).
		WithWorkdir("/workspace/jev-playwright").
		WithFile("package.json", harness.File("package.json")).
		WithFile("package-lock.json", harness.File("package-lock.json")).
		WithExec([]string{"npm", "ci", "--no-audit", "--no-fund"}).
		WithDirectory(".", harness).
		WithEnvVariable("PROTON_PASS_KEY_PROVIDER", "fs").
		WithEnvVariable("PASS_SESSION_PLANNER", "/pass/planner").
		WithEnvVariable("PASS_SESSION_JUDGE", "/pass/judge")
	if plannerToken != nil {
		c = c.WithSecretVariable("PLANNER_TOKEN", plannerToken)
	}
	if judgeToken != nil {
		c = c.WithSecretVariable("JUDGE_TOKEN", judgeToken)
	}
	return c.
		WithNewFile("/delivery.sh", `set -eu
for role in planner judge; do
  token="$(printenv "$(echo "$role" | tr a-z A-Z)_TOKEN" || true)"
  [ -n "$token" ] || { echo "the $role's Pass token is missing (--$role-token)" >&2; exit 1; }
  PROTON_PASS_PERSONAL_ACCESS_TOKEN="$token" PROTON_PASS_SESSION_DIR="/pass/$role" pass-cli login >&2
done
npx playwright test -c delivery --project feature-plan
node delivery/diagnostics.mjs delivery/feature.spec.ts > /plan.json
npx playwright test -c delivery --project feature
node delivery/diagnostics.mjs delivery/feature.spec.ts > /work.json
node /forward.mjs delivery/feature.spec.ts /plan.json /work.json
`).
		WithNewFile("/forward.mjs", `import { readFileSync } from 'node:fs';
// What witness shows on the spec after the plan run, then after the work run.
// Every answer is on a test's line and none is stale; some step cooled beyond
// noise and none warmed beyond it. Noise is render.mjs's MOVED, twice the
// spread typesafe-experiment measured.
const MOVED = 0.12;
const [spec, ...runs] = process.argv.slice(2);
const lines = readFileSync(spec, 'utf8').split('\n');
const [plan, work] = runs.map((f) => {
  const shown = new Map();
  for (const d of JSON.parse(readFileSync(f, 'utf8'))) {
    const m = /^(\d\.\d\d) still a priority: (.*)$/.exec(d.message);
    if (!m) continue;
    if (!/^\s*test\(/.test(lines[d.range.start.line])) throw new Error('not on a test line: line ' + (d.range.start.line + 1) + '  ' + d.message);
    shown.set(m[2], Number(m[1]));
  }
  const stale = JSON.parse(readFileSync(f, 'utf8')).filter((d) => d.message.startsWith('stale'));
  if (stale.length) throw new Error(f + ': witness shows stale findings: ' + stale.map((d) => d.message).join('; '));
  if (!shown.size) throw new Error(f + ': witness shows no priorities on ' + spec);
  console.log(f + ': ' + shown.size + ' priorities shown on ' + spec);
  return shown;
});
const moved = [...work].filter(([s]) => plan.has(s)).map(([s, p]) => ({ step: s, d: p - plan.get(s) }));
for (const m of moved) console.log((m.d <= -MOVED ? 'cooled ' : m.d >= MOVED ? 'warmed ' : 'steady ') + m.d.toFixed(2) + '  ' + m.step);
const cooled = moved.filter((m) => m.d <= -MOVED), warmed = moved.filter((m) => m.d >= MOVED);
console.log('Next: ' + [...work].sort((a, b) => b[1] - a[1])[0][0]);
if (!cooled.length || warmed.length) {
  console.error('The priorities did not move forward: ' + cooled.length + ' cooled, ' + warmed.length + ' warmed');
  process.exit(1);
}
`).
		WithExec([]string{"bash", "/delivery.sh"})
}
