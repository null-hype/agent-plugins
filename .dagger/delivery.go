package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"fmt"
	"strings"
)

// PeopleCanInstallWitness: people can install witness and see each answer on
// the line of the test that asked it (jev-playwright/delivery/goal.md).
//
// The delivery loop runs twice, as Playwright: once to Jules's approved plan
// (feature-plan), once to the files Jules wrote (feature). Each run, the
// priority reporter asks Jev what is still a priority for the goal and leaves
// each answer as a witness finding on the line of its test. The check installs
// the dev container feature Jules wrote into a clean dev container; when that
// fails, Jules is given the failure and repairs its work, and the check
// installs again, up to three repairs. It then opens the spec, as an editor
// would, in the witness that feature installed, once on each run. It passes
// when every answer shows on its test's line, none is stale, and between the
// plan and the last work the priorities moved forward: some step cooled beyond
// noise, and none warmed beyond it.
//
// Each agent logs in to Pass with its own token. The repo's .env gives the
// tokens as defaults, env:// variables that pass-cli resolves from pass:// refs:
//
//	pass-cli run --env-file .env -- dagger check people-can-install-witness
//
// +check
func (m *AgentPlugins) PeopleCanInstallWitness(
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
	delivered := m.Delivery(harness, plannerToken, judgeToken)
	var installed *dagger.Container
	for repairs := 0; ; repairs++ {
		feature := delivered.Directory("/feature")
		installed = devcontainer(feature).
			WithEnvVariable("REPAIRS", fmt.Sprint(repairs)).
			WithExec([]string{"bash", "-c", "exec 2>&1; echo \"installing the feature $(cat * | sha256sum | cut -c1-12), repair $REPAIRS\"; " + installFeature + ` && { w="$(command -v witness)" || { echo "the feature installed no witness on PATH"; exit 1; }; cp "$w" /witness; }`},
				dagger.ContainerWithExecOpts{Expect: dagger.ReturnTypeAny})
		code, err := installed.ExitCode(ctx)
		if err != nil {
			return err
		}
		if code == 0 {
			break
		}
		out, err := installed.Stdout(ctx)
		if err != nil {
			return err
		}
		if repairs == 3 {
			return fmt.Errorf("the feature Jules wrote still fails to install after %d repairs:\n%s", repairs, tail(out, 40))
		}
		// The evidence is the world as it was: the feature as installed, and
		// its install log. Jules's next turn does not have its files.
		failed, err := evidence(ctx, feature, tail(out, 40))
		if err != nil {
			return err
		}
		delivered = delivered.
			WithNewFile("/failed.txt", failed).
			WithExec([]string{"bash", "/repair.sh"})
	}
	_, err := delivered.
		WithFile("/usr/local/bin/witness", installed.File("/witness")).
		WithExec([]string{"sh", "-c", `set -e
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > /plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > /work.json
node /forward.mjs delivery/feature.spec.ts /plan.json /work.json`}).
		Sync(ctx)
	return err
}

// The feature's files, then its install log: the log last, ending on how it failed.
func evidence(ctx context.Context, feature *dagger.Directory, log string) (string, error) {
	names, err := feature.Entries(ctx)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString("The feature, as installed:\n")
	for _, name := range names {
		content, err := feature.File(name).Contents(ctx)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "\n--- %s\n%s", name, content)
	}
	fmt.Fprintf(&b, "\nIts install log, the last lines:\n\n%s", log)
	return b.String(), nil
}

// The last n lines of s.
func tail(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n") + "\n"
}

// Delivery runs the delivery loop for the goal and leaves its reports in
// jev-playwright/delivery/test-results, each run's witness run in /runs, and
// the dev container feature Jules wrote in /feature.
func (m *AgentPlugins) Delivery(
	// +defaultPath="/jev-playwright"
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", "**/.witness"]
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
mkdir -p /runs && cp -r delivery/.witness/run /runs/plan
npx playwright test -c delivery --project feature
. /work.sh
`).
		WithNewFile("/repair.sh", `set -eu
# Jules repairs its work with how it failed, and the work run is read again.
DELIVERY_FAILED=/failed.txt npx playwright test -c delivery --project feature
. /work.sh
`).
		WithNewFile("/work.sh", `rm -rf /runs/work /feature
cp -r delivery/.witness/run /runs/work
# The dev container feature Jules wrote: the directory with its manifest.
manifest="$(find delivery/test-results/feature-* -name devcontainer-feature.json | head -1)"
[ -n "$manifest" ] || { echo "Jules wrote no dev container feature" >&2; exit 1; }
cp -r "$(dirname "$manifest")" /feature
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

// Install installs a dev container feature into a dev container, as the dev
// container CLI does: as root, its options' defaults in the environment.
func (m *AgentPlugins) Install(feature *dagger.Directory) *dagger.Container {
	return devcontainer(feature).WithExec([]string{"bash", "-c", installFeature})
}

// A clean dev container, the feature in it, not yet installed.
func devcontainer(feature *dagger.Directory) *dagger.Container {
	return dag.Container().
		From("mcr.microsoft.com/devcontainers/base:bookworm").
		WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq jq"}).
		WithDirectory("/tmp/feature", feature).
		WithWorkdir("/tmp/feature").
		WithEnvVariable("_REMOTE_USER", "vscode").
		WithEnvVariable("_REMOTE_USER_HOME", "/home/vscode")
}

const installFeature = `eval "$(jq -r '.options // {} | to_entries[] | "export \(.key | ascii_upcase)=\(.value.default | tostring | @sh)"' devcontainer-feature.json)" && bash install.sh`
