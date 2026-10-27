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
// priority reporter asks Jev what is still a priority for the goal. The check
// passes when the tests pass and the work moved the priorities forward: some
// step cooled beyond noise, and none warmed beyond it.
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
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", ".witness"]
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
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", ".witness"]
	harness *dagger.Directory,
	// +optional
	plannerToken *dagger.Secret,
	// +optional
	judgeToken *dagger.Secret,
) *dagger.Container {
	c := dag.Container().
		From("node:22-bookworm").
		WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq jq && curl -fsSL https://proton.me/download/pass-cli/install.sh | bash"}).
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
npx playwright test -c delivery --project feature
node /forward.mjs delivery/.priorities/history.jsonl
`).
		WithNewFile("/forward.mjs", `import { readFileSync } from 'node:fs';
// Did the work move the priorities forward? The last two rankings, plan then
// work: some item cooled beyond noise, and none warmed beyond it. Noise is
// render.mjs's MOVED, twice the spread typesafe-experiment measured.
const MOVED = 0.12;
const runs = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const [before, after] = runs.slice(-2);
if (!before || before.level !== 'plan' || after.level !== 'work') throw new Error('expected a plan run, then a work run');
const was = new Map(before.ranked.map((r) => [r.work, r.p]));
const moved = after.ranked.filter((r) => was.has(r.work)).map((r) => ({ work: r.work, d: r.p - was.get(r.work) }));
for (const m of moved) console.log((m.d <= -MOVED ? 'cooled ' : m.d >= MOVED ? 'warmed ' : 'steady ') + m.d.toFixed(2) + '  ' + m.work);
const cooled = moved.filter((m) => m.d <= -MOVED), warmed = moved.filter((m) => m.d >= MOVED);
console.log('Next: ' + after.ranked[0].work);
if (!cooled.length || warmed.length) {
  console.error('The priorities did not move forward: ' + cooled.length + ' cooled, ' + warmed.length + ' warmed');
  process.exit(1);
}
`).
		WithExec([]string{"bash", "/delivery.sh"})
}
