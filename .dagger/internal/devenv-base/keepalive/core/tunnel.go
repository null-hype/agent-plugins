// Package core holds the timing-critical pieces of the devpod-keepalive
// rewrite (JIN-128): the Tunnel abstraction, the 30s-tick KeepAlive
// guarantee, and (in the sibling retry package) the typed-error retry state
// machine. Deliberately free of any dagger/devenv-base internal/dagger
// import so `go test ./keepalive/...` runs as plain `go test`, no Dagger
// codegen or container required -- see JIN-128's "Testability payoff".
package core

import "context"

// Tunnel is a single long-lived session against the devpod-managed
// workspace that a keepalive run's bootstrap sequence executes over, in
// place of the old pattern of opening a separate one-shot `devpod ssh
// --command` tunnel per bootstrap step (gce_common_ssh_step in
// gce-common.sh). One Tunnel covers a whole keepalive run: see KeepAlive,
// which holds it open past devpod's 30s watchdog-reset tick regardless of
// how long the bootstrap steps themselves take.
type Tunnel interface {
	// Open establishes the session. Must be called before Run/Restart/Close.
	Open(ctx context.Context) error

	// Run executes one bootstrap step (a script name, e.g. from
	// gce_common_bootstrap_steps in gce-common.sh) as a remote command over
	// the already-open session. extraEnv entries are "KEY=value" pairs
	// passed through to the remote step's environment (mirroring
	// gce_common_ssh_step's `--set-env` passthrough). Returns the step's
	// combined stdout/stderr and a non-nil error if the step's own exit
	// code was non-zero.
	Run(ctx context.Context, script string, extraEnv ...string) (output string, err error)

	// Restart recovers a stopped/missing workspace (the shell script's
	// `devpod up` recovery path) and re-establishes the session. Only
	// meaningful after Run's result classifies as "workspace stopped" --
	// see the retry package.
	Restart(ctx context.Context) error

	// Close tears down the session.
	Close() error
}
