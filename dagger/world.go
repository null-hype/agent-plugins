package main

import (
	"context"
	"dagger/worlds/internal/dagger"
	"strings"
)

// A World is a directory, /world in a container, that a producer fills and a
// judge reads, kept as a restic snapshot. The store asks nothing of what is in
// it: what a judge reads is the contract between that producer and that judge,
// and more files are carried along, so richer evidence (Playwright reports,
// traces) can join a world without changing how it is kept, selected or passed
// on. This file knows no experiment; world/world.sh does the work.
//
//	producer → World → judge → verdict
//
// Identity is the snapshot: Capture returns its exact id and Judge takes that
// id, or a label to select the newest world with it. A world is selected among
// those of one check, the name of what judges it.
const worldDir = "/world"

// Where worlds are kept: the shared restic repository when its secrets are
// given, otherwise a cache volume local to the engine (which can prune it; its
// password keeps the repository's integrity, not a secret).
type Store struct {
	repository, password, gcpKey *dagger.Secret
}

func (w Store) in(c *dagger.Container) *dagger.Container {
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
// snapshot's id. The container needs world/world.sh in its working directory.
func (w Store) Capture(ctx context.Context, producer *dagger.Container, check, label, run string) (string, error) {
	out, err := w.in(producer).
		WithEnvVariable("WORLD_CHECK", check).
		WithExec([]string{"bash", "world/world.sh", "capture", worldDir, label, run}).
		Stdout(ctx)
	return strings.TrimSpace(out), err
}
