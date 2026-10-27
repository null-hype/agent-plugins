package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"encoding/json"
	"fmt"
	"strings"
)

// PeopleCanInstallWitness: people can install witness and see each answer on
// the line of the test that asked it (jev-playwright/delivery/goal.md).
//
// What the check runs and expects is registered before it, in
// jev-playwright/delivery/Delivery.pkl, and evaluated before any agent call:
// Jules's task, Jev's question and model, the measured noise, the approved
// plan and what the work should do to each of its steps, and how many repairs
// the world allows.
//
// The delivery loop runs twice, as Playwright: once to Jules's approved plan
// (feature-plan), once to the files Jules wrote (feature). Each run, the
// priority reporter asks Jev the registered question of each step and leaves
// each answer as a witness finding on the line of its test. The check installs
// the dev container feature Jules wrote into a clean dev container; when that
// fails, Jules is given the feature as installed and its install log, repairs
// it, and the check installs the repair into a fresh dev container, up to the
// registered repairs. It then opens the spec, as an editor would, in the
// witness that feature installed, once on each run, and Reconcile.pkl judges
// what witness showed against the registration.
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
	out, err := withPkl(dag.Container().From("node:22-bookworm")).
		WithDirectory("/h", harness).
		WithExec([]string{"pkl", "eval", "-f", "json", "/h/delivery/Delivery.pkl"}).
		Stdout(ctx)
	if err != nil {
		return fmt.Errorf("Delivery.pkl registers no valid delivery: %w", err)
	}
	var registered struct {
		Repairs  int `json:"repairs"`
		LogLines int `json:"logLines"`
	}
	if err := json.Unmarshal([]byte(out), &registered); err != nil {
		return err
	}
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
		out, err = installed.Stdout(ctx)
		if err != nil {
			return err
		}
		if repairs == registered.Repairs {
			return fmt.Errorf("the feature Jules wrote still fails to install after %d repairs:\n%s", repairs, tail(out, registered.LogLines))
		}
		// The evidence is the world as it was: the feature as installed, and
		// its install log. Jules's next turn does not have its files.
		failed, err := evidence(ctx, feature, tail(out, registered.LogLines))
		if err != nil {
			return err
		}
		delivered = delivered.
			WithNewFile("/failed.txt", failed).
			WithExec([]string{"bash", "/repair.sh"})
	}
	_, err = delivered.
		WithFile("/usr/local/bin/witness", installed.File("/witness")).
		WithExec([]string{"sh", "-c", `set -e
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > /plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > /work.json
node delivery/facts.mjs delivery/feature.spec.ts /facts.json plan=/plan.json,/runs/plan work=/work.json,/runs/work
pkl eval -f json -p observed=file:///facts.json delivery/Reconcile.pkl > /verdict.json
jq -r '.facts | to_entries[] | (if .value then "✓ " else "✗ " end) + .key' /verdict.json
jq -r '.movements | to_entries[] | "  \(.value * 100 | round / 100)  \(.key)"' /verdict.json
jq -r '"Next: " + .next' /verdict.json
jq -e .pass /verdict.json > /dev/null || { echo "the run does not match what Delivery.pkl registered" >&2; exit 1; }`}).
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
