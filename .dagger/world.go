package main

import (
	"context"
	"dagger/agent-plugins/internal/dagger"
	"strings"
)

// A World is a directory, /world in a container, that a producer fills and a
// judge reads, kept as a restic snapshot. The contract is the files the judge
// reads (delivery/world.sh lists them) and nothing else: more files in it are
// carried along, so richer evidence (Playwright reports, traces) can join a
// world without changing how it is kept, selected or passed on.
//
//	producer → World → judge → verdict
//
// Identity is the snapshot: Capture returns its exact id and Judge takes that
// id, or a label to select the newest world with it.
const worldDir = "/world"

// Where worlds are kept: the shared restic repository when its secrets are
// given, otherwise a cache volume local to the engine (which can prune it; its
// password keeps the repository's integrity, not a secret).
type Worlds struct {
	repository, password, gcpKey *dagger.Secret
}

func (w Worlds) in(c *dagger.Container) *dagger.Container {
	c = c.WithExec([]string{"sh", "-c", "apt-get update -qq && apt-get install -y -qq restic ca-certificates"})
	if w.repository == nil || w.password == nil {
		return c.
			WithMountedCache("/worlds", dag.CacheVolume("delivery-worlds")).
			WithEnvVariable("RESTIC_REPOSITORY", "/worlds").
			WithEnvVariable("RESTIC_PASSWORD", "delivery-worlds")
	}
	c = c.
		WithSecretVariable("RESTIC_REPOSITORY", w.repository).
		WithSecretVariable("RESTIC_PASSWORD", w.password)
	if w.gcpKey != nil {
		c = c.
			WithMountedSecret("/run/gcp-service-account.json", w.gcpKey).
			WithEnvVariable("GOOGLE_APPLICATION_CREDENTIALS", "/run/gcp-service-account.json")
	}
	return c
}

// Capture snapshots the producer's /world under the label and returns the
// snapshot's id. The container needs delivery/world.sh in its working directory.
func (w Worlds) Capture(ctx context.Context, producer *dagger.Container, label, run string) (string, error) {
	out, err := w.in(producer).
		WithExec([]string{"bash", "delivery/world.sh", "capture", worldDir, label, run}).
		Stdout(ctx)
	return strings.TrimSpace(out), err
}

// Judge restores the world (a snapshot id, or a label for the newest with it)
// apart from where it was made and judges it with Reconcile.pkl; the output
// names the snapshot. An error is a verdict that is not green.
func (w Worlds) Judge(ctx context.Context, judge *dagger.Container, snapshot string) error {
	_, err := w.in(judge).WithExec([]string{"bash", "delivery/world.sh", "judge", snapshot}).Sync(ctx)
	return err
}

// The Playwright evidence adapter: what a delivery run leaves in the container
// (witness's run of the plan and of the work, the spec, the feature, the
// failures) becomes the contents of a world.
func playwrightEvidence(delivered *dagger.Container) *dagger.Container {
	return delivered.WithExec([]string{"sh", "-c", `set -e
w=` + worldDir + `; rm -rf $w; mkdir -p $w
cp -r /runs/plan $w/plan-run; cp -r /runs/work $w/work-run; cp -r /feature $w/feature
cp -r delivery/test-results $w/test-results; [ ! -f /failed.txt ] || cp /failed.txt $w/
cp delivery/feature.spec.ts $w/spec.txt
WITNESS_RUN_DIR=/runs/plan node delivery/diagnostics.mjs delivery/feature.spec.ts > $w/plan.json
WITNESS_RUN_DIR=/runs/work node delivery/diagnostics.mjs delivery/feature.spec.ts > $w/work.json`})
}
