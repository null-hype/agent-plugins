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
	world, err := m.installedWitness(ctx, m.Delivery(harness, plannerToken, judgeToken, ""), repairs, logLines)
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
// predicted in Pass (jev-playwright/delivery/Predicted.pkl): what the work
// should do to each step of Jules's plan. The planner registers once Jules has
// presented its plan and before the plan is approved, so the predictions bind
// to the plan as presented and are fixed before any work: the check runs the
// plan, and stops there, printing its steps, until the planner has registered
// for exactly them. Then it approves the plan, and Jules works. The judge
// reads the predictions from the planner's journal, which it can view and not
// change, again after the world, and Reconcile.pkl's `facts` judge: the
// world's facts, the predictions last changed after Jules was asked for the
// plan and before Jules recorded it approved, both runs show exactly the
// predicted steps, Jev answered on Delivery.pkl's model, and the work moved
// each step as predicted, by Delivery.pkl's `moved`.
//
// The world is a restic snapshot (delivery/world.sh): the check captures the
// completed run labelled observed, then judges the snapshot it selects by
// `label`, restored apart. REGISTEREDDELIVERY_LABEL=synthetic judges a world
// CaptureWorld made instead, without running Jules.
//
//	pass-cli run --env-file .env -- dagger check registered-delivery   # stops at the plan
//	node delivery/register.mjs <predictions.json>                      # the planner
//	pass-cli run --env-file .env -- dagger check registered-delivery   # the same plan, worked
//
// Never cached as a call, so the predictions are read each time it is checked.
//
// +check
// +cache="never"
func (m *AgentPlugins) RegisteredDelivery(
	ctx context.Context,
	// +defaultPath="/jev-playwright"
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", "**/.witness"]
	harness *dagger.Directory,
	// +optional
	plannerToken *dagger.Secret,
	// +optional
	judgeToken *dagger.Secret,
	// Keys Jules's sessions: under the same key the check resumes the same
	// plan, so the planner can register for it; under another, Jules is asked anew.
	// +default="registered"
	run string,
	// Which world to judge, by its snapshot's label: observed runs the
	// delivery and snapshots what it made; any other (synthetic) judges the
	// newest snapshot with that label, made by CaptureWorld. In .env:
	// REGISTEREDDELIVERY_LABEL=synthetic.
	// +default="observed"
	label string,
	// +default=3
	repairs int,
	// +default=40
	logLines int,
) error {
	// A world other than the one this run makes is judged as it was snapshotted.
	if label != observedLabel {
		return judged(ctx, withWorlds(base(harness)), label)
	}
	planned := m.planned(harness, plannerToken, judgeToken, run)
	// The work waits for the planner: the predictions as registered now, for this plan.
	ready := planned.
		WithEnvVariable("READ_AT", time.Now().UTC().Format(time.RFC3339Nano)).
		WithExec([]string{"sh", "-c", "set -eu; node delivery/registered.mjs > /registered.json; node delivery/ready.mjs /registered.json /runs/plan/priorities.json"},
			dagger.ContainerWithExecOpts{Expect: dagger.ReturnTypeAny})
	code, err := ready.ExitCode(ctx)
	if err != nil {
		return err
	}
	if code != 0 {
		waiting, err := ready.Stderr(ctx)
		if err != nil {
			return err
		}
		return fmt.Errorf("%s", waiting)
	}
	world, err := m.installedWitness(ctx, worked(planned), repairs, logLines)
	if err != nil {
		return err
	}
	// The completed world, snapshotted: what witness showed of both runs, the
	// spec, the predictions as read now (whatever the world's cache), and the
	// feature. The verdict is then judged from the snapshot, not from here.
	return judged(ctx, withWorlds(world).
		WithEnvVariable("RUN", run).
		WithEnvVariable("READ_AT", time.Now().UTC().Format(time.RFC3339Nano)).
		WithExec([]string{"sh", "-c", `set -e
w=/world; rm -rf $w; mkdir -p $w
cp -r /runs/plan $w/plan-run; cp -r /runs/work $w/work-run; cp -r /feature $w/feature
cp delivery/feature.spec.ts $w/
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > $w/plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > $w/work.json
node delivery/registered.mjs > $w/registered.json
bash delivery/world.sh capture $w ` + observedLabel + ` "$RUN"`}), label)
}

const observedLabel = "observed"

// A restic repository for worlds, in a cache volume so snapshots outlast a
// check. It is local: its password keeps the repository's integrity, not a secret.
func withWorlds(c *dagger.Container) *dagger.Container {
	return c.
		WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq restic"}).
		WithMountedCache("/worlds", dag.CacheVolume("delivery-worlds")).
		WithEnvVariable("RESTIC_REPOSITORY", "/worlds").
		WithEnvVariable("RESTIC_PASSWORD", "delivery-worlds")
}

// The world labelled `label`, restored apart and judged by Reconcile.pkl: the
// same check on whichever world is selected. Its output names the snapshot.
func judged(ctx context.Context, c *dagger.Container, label string) error {
	_, err := c.WithExec([]string{"bash", "delivery/world.sh", "judge", label}).Sync(ctx)
	return err
}

// CaptureWorld snapshots a world (a directory as delivery/world.sh describes,
// e.g. jev-playwright/delivery/worlds/run7) under a label, for RegisteredDelivery
// to judge by that label; it returns the snapshot's id.
func (m *AgentPlugins) CaptureWorld(
	ctx context.Context,
	// +defaultPath="/jev-playwright"
	// +ignore=["node_modules", ".jules", "runs", "**/test-results", "**/.priorities", "**/.witness"]
	harness *dagger.Directory,
	// The world: its registered.json, plan.json, work.json, feature.spec.ts, plan-run and work-run.
	world *dagger.Directory,
	// How it came to be: synthetic, observed.
	label string,
	// +optional
	run string,
) (string, error) {
	out, err := withWorlds(dag.Container().From("debian:bookworm-slim")).
		WithExec([]string{"sh", "-c", "apt-get install -y -qq jq"}).
		WithFile("/world.sh", harness.File("delivery/world.sh")).
		WithDirectory("/world", world).
		WithExec([]string{"bash", "/world.sh", "capture", "/world", label, run}).
		Stdout(ctx)
	return strings.TrimSpace(out), err
}

// What witness showed of both runs, as data for Reconcile.pkl: facts.json.
const observe = `set -e
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > /plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > /work.json
node delivery/facts.mjs delivery/feature.spec.ts /facts.json plan=/plan.json,/runs/plan work=/work.json,/runs/work`

// The delivery, its feature installed into a clean dev container, repaired
// up to `repairs` times, and the witness it installed on the delivery's PATH.
func (m *AgentPlugins) installedWitness(ctx context.Context, delivered *dagger.Container, repairs, logLines int) (*dagger.Container, error) {
	for repair := 0; ; repair++ {
		feature := delivered.Directory("/feature")
		installed := devcontainer(feature).
			WithEnvVariable("REPAIRS", fmt.Sprint(repair)).
			WithExec([]string{"bash", "-c", "exec 2>&1; echo \"installing the feature $(find . -maxdepth 1 -type f -exec cat {} + | sha256sum | cut -c1-12), repair $REPAIRS\"; " + installFeature + ` && { w="$(command -v witness)" || { echo "the feature installed no witness on PATH"; exit 1; }; cp "$w" /witness; }`},
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
	// How the world installs it is part of how it failed: this world does
	// not resolve dependsOn or installsAfter, as the dev container CLI would.
	b.WriteString("The feature, as installed: alone, into a clean " + cleanImage + ", as root, its options' defaults in the environment, by running its install.sh. Nothing is installed before it: dependsOn and installsAfter are not resolved.\n")
	for _, name := range names {
		// The files Jules wrote: a run's directory beside them, as its attachments, is not.
		if strings.HasSuffix(name, "/") {
			continue
		}
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
	// Keys Jules's sessions: under the same key, or none, running again
	// reuses them; under another, Jules is asked anew.
	// +optional
	sessions string,
) *dagger.Container {
	return worked(m.planned(harness, plannerToken, judgeToken, sessions))
}

// The delivery loop to Jules's plan, not yet approved: the plan run, its
// witness run in /runs/plan.
func (m *AgentPlugins) planned(harness *dagger.Directory, plannerToken, judgeToken *dagger.Secret, sessions string) *dagger.Container {
	c := withLogins(base(harness), plannerToken, judgeToken)
	if sessions != "" {
		c = c.WithEnvVariable("DELIVERY_SESSIONS", sessions)
	}
	return c.
		WithNewFile("/plan.sh", `set -eu
. /logins.sh
npx playwright test -c delivery --project feature-plan
mkdir -p /runs && cp -r delivery/.witness/run /runs/plan
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
		WithExec([]string{"bash", "/plan.sh"})
}

// The planned delivery, its plan approved and worked: the work run, its
// witness run in /runs/work, and the feature Jules wrote in /feature.
func worked(planned *dagger.Container) *dagger.Container {
	return planned.WithExec([]string{"bash", "-c", "set -eu; npx playwright test -c delivery --project feature; . /work.sh"})
}

// The harness, its dependencies installed, with pass-cli and Pkl.
func base(harness *dagger.Directory) *dagger.Container {
	return withPkl(dag.Container().From("node:22-bookworm")).
		WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq jq && curl -fsSL https://proton.me/download/pass-cli/install.sh | bash"}).
		WithEnvVariable("PATH", "/root/.local/bin:$PATH", dagger.ContainerWithEnvVariableOpts{Expand: true}).
		WithWorkdir("/workspace/jev-playwright").
		WithFile("package.json", harness.File("package.json")).
		WithFile("package-lock.json", harness.File("package-lock.json")).
		WithExec([]string{"npm", "ci", "--no-audit", "--no-fund"}).
		WithDirectory(".", harness)
}

// The agents' Pass tokens, and /logins.sh, which logs each in to its own session.
func withLogins(c *dagger.Container, plannerToken, judgeToken *dagger.Secret) *dagger.Container {
	c = c.
		WithEnvVariable("PROTON_PASS_KEY_PROVIDER", "fs").
		WithEnvVariable("PASS_SESSION_PLANNER", "/pass/planner").
		WithEnvVariable("PASS_SESSION_JUDGE", "/pass/judge")
	if plannerToken != nil {
		c = c.WithSecretVariable("PLANNER_TOKEN", plannerToken)
	}
	if judgeToken != nil {
		c = c.WithSecretVariable("JUDGE_TOKEN", judgeToken)
	}
	return c.WithNewFile("/logins.sh", `for role in planner judge; do
  token="$(printenv "$(echo "$role" | tr a-z A-Z)_TOKEN" || true)"
  [ -n "$token" ] || { echo "the $role's Pass token is missing (--$role-token)" >&2; exit 1; }
  PROTON_PASS_PERSONAL_ACCESS_TOKEN="$token" PROTON_PASS_SESSION_DIR="/pass/$role" pass-cli login >&2
done
`)
}

// Pkl, the version the jev feature installs, on the container's PATH.
func withPkl(c *dagger.Container) *dagger.Container {
	return c.WithExec([]string{"sh", "-c", `curl -fsSL "https://github.com/apple/pkl/releases/download/0.32.1/pkl-linux-$(dpkg --print-architecture | sed s/arm64/aarch64/)" -o /usr/local/bin/pkl && chmod +x /usr/local/bin/pkl`})
}

// Install installs a dev container feature into a dev container, as the dev
// container CLI does: as root, its options' defaults in the environment.
// Unlike the CLI, it installs no feature the feature depends on.
func (m *AgentPlugins) Install(feature *dagger.Directory) *dagger.Container {
	return devcontainer(feature).WithExec([]string{"bash", "-c", installFeature})
}

const cleanImage = "mcr.microsoft.com/devcontainers/base:bookworm"

// A clean dev container, the feature in it, not yet installed.
func devcontainer(feature *dagger.Directory) *dagger.Container {
	return dag.Container().
		From(cleanImage).
		WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq jq"}).
		WithDirectory("/tmp/feature", feature).
		WithWorkdir("/tmp/feature").
		WithEnvVariable("_REMOTE_USER", "vscode").
		WithEnvVariable("_REMOTE_USER_HOME", "/home/vscode")
}

const installFeature = `eval "$(jq -r '.options // {} | to_entries[] | "export \(.key | ascii_upcase)=\(.value.default | tostring | @sh)"' devcontainer-feature.json)" && bash install.sh`
