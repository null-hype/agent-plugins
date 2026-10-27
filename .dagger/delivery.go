package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"fmt"
	"strings"
	"time"
)

// PeopleCanInstallWitness: people can install witness and see each answer on
// the line of the test that asked it (jev-playwright/delivery/goal.md). The
// world's postcondition, nothing predicted: RegisteredDelivery adds that.
//
// The delivery loop runs twice, as Playwright, asking what
// jev-playwright/delivery/Delivery.pkl says to ask: once to Jules's approved
// plan (feature-plan), once to the files Jules wrote (feature). Each run, the
// priority reporter asks Jev of each step and leaves each answer as a witness
// finding on the line of its test. The check installs the dev container
// feature Jules wrote into a clean dev container; when that fails, Jules is
// given the feature as installed and its install log, repairs it, and the
// check installs the repair into a fresh dev container, up to `repairs`. It
// then opens the spec, as an editor would, in the witness that feature
// installed, once on each run, and Reconcile.pkl's `installed` judges what it
// showed: every answer fresh and on its test's line.
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
	// How many times the world's failure goes back to Jules before the check fails.
	// +default=3
	repairs int,
	// How much of the install log goes back to Jules with the feature.
	// +default=40
	logLines int,
) error {
	world, err := m.installedWitness(ctx, harness, plannerToken, judgeToken, repairs, logLines)
	if err != nil {
		return err
	}
	_, err = world.
		WithExec([]string{"sh", "-c", observe + `
pkl eval -f json -x installed -p observed=file:///facts.json delivery/Reconcile.pkl > /installed.json
jq -r 'to_entries[] | (if .value then "✓ " else "✗ " end) + .key' /installed.json
jq -e 'all(.[]; .)' /installed.json > /dev/null || { echo "witness does not show every answer fresh on its test's line" >&2; exit 1; }`}).
		Sync(ctx)
	return err
}

// RegisteredDelivery: the delivery experiment came out as registered. It is
// PeopleCanInstallWitness's world, judged also against what the planner
// predicted in Pass before the run (jev-playwright/delivery/Predicted.pkl):
// what the work should do to each step of Jules's approved plan. The judge
// reads the predictions after the run, fresh, from the planner's journal,
// which it can view and not change, and Reconcile.pkl's `facts` judge: the
// world's facts, the predictions last changed before the plan run began, both
// runs show exactly the predicted steps, Jev answered on Delivery.pkl's model,
// and the work moved each step as predicted, by Delivery.pkl's `moved`.
//
// The planner registers before the run (jev-playwright/delivery/README.md):
//
//	node delivery/register.mjs <predictions.json>
//	pass-cli run --env-file .env -- dagger check registered-delivery
//
// +check
func (m *AgentPlugins) RegisteredDelivery(
	ctx context.Context,
	// +defaultPath="/jev-playwright"
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", "**/.witness"]
	harness *dagger.Directory,
	// +optional
	plannerToken *dagger.Secret,
	// +optional
	judgeToken *dagger.Secret,
	// +default=3
	repairs int,
	// +default=40
	logLines int,
) error {
	world, err := m.installedWitness(ctx, harness, plannerToken, judgeToken, repairs, logLines)
	if err != nil {
		return err
	}
	_, err = world.
		// The predictions are read now, whatever the world's cache.
		WithEnvVariable("READ_AT", time.Now().UTC().Format(time.RFC3339Nano)).
		WithExec([]string{"sh", "-c", observe + `
node delivery/registered.mjs > /registered.json
pkl eval -f json -p observed=file:///facts.json -p registered=file:///registered.json delivery/Reconcile.pkl > /verdict.json
jq -r '"Registered: " + .registration' /verdict.json
jq -r '.facts | to_entries[] | (if .value then "✓ " else "✗ " end) + .key' /verdict.json
jq -r '.movements | to_entries[] | "  \(.value * 100 | round / 100)  \(.key)"' /verdict.json
jq -r '"Next: " + .next' /verdict.json
jq -e .pass /verdict.json > /dev/null || { echo "the run does not match what was registered" >&2; exit 1; }`}).
		Sync(ctx)
	return err
}

// What witness showed of both runs, as data for Reconcile.pkl: facts.json.
const observe = `set -e
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > /plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > /work.json
node delivery/facts.mjs delivery/feature.spec.ts /facts.json plan=/plan.json,/runs/plan work=/work.json,/runs/work`

// The delivery, its feature installed into a clean dev container, repaired
// up to `repairs` times, and the witness it installed on the delivery's PATH.
func (m *AgentPlugins) installedWitness(ctx context.Context, harness *dagger.Directory, plannerToken, judgeToken *dagger.Secret, repairs, logLines int) (*dagger.Container, error) {
	delivered := m.Delivery(harness, plannerToken, judgeToken)
	for repair := 0; ; repair++ {
		feature := delivered.Directory("/feature")
		installed := devcontainer(feature).
			WithEnvVariable("REPAIRS", fmt.Sprint(repair)).
			WithExec([]string{"bash", "-c", "exec 2>&1; echo \"installing the feature $(cat * | sha256sum | cut -c1-12), repair $REPAIRS\"; " + installFeature + ` && { w="$(command -v witness)" || { echo "the feature installed no witness on PATH"; exit 1; }; cp "$w" /witness; }`},
				dagger.ContainerWithExecOpts{Expect: dagger.ReturnTypeAny})
		code, err := installed.ExitCode(ctx)
		if err != nil {
			return nil, err
		}
		if code == 0 {
			return delivered.WithFile("/usr/local/bin/witness", installed.File("/witness")), nil
		}
		out, err := installed.Stdout(ctx)
		if err != nil {
			return nil, err
		}
		if repair == repairs {
			return nil, fmt.Errorf("the feature Jules wrote still fails to install after %d repairs:\n%s", repair, tail(out, logLines))
		}
		// The evidence is the world as it was: the feature as installed, and
		// its install log. Jules's next turn does not have its files.
		failed, err := evidence(ctx, feature, tail(out, logLines))
		if err != nil {
			return nil, err
		}
		delivered = delivered.
			WithNewFile("/failed.txt", failed).
			WithExec([]string{"bash", "/repair.sh"})
	}
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
	c := withPkl(dag.Container().From("node:22-bookworm")).
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
		WithExec([]string{"bash", "/delivery.sh"})
}

// Pkl, the version the jev feature installs, on the container's PATH.
func withPkl(c *dagger.Container) *dagger.Container {
	return c.WithExec([]string{"sh", "-c", `curl -fsSL "https://github.com/apple/pkl/releases/download/0.32.1/pkl-linux-$(dpkg --print-architecture | sed s/arm64/aarch64/)" -o /usr/local/bin/pkl && chmod +x /usr/local/bin/pkl`})
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
