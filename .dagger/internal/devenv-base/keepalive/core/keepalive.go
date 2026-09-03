package core

import (
	"context"
	"fmt"
	"time"
)

// KeepAlive opens tunnel, runs steps against it, then unconditionally
// blocks until minDuration has elapsed since Open before letting tunnel
// close -- even if steps returns instantly, or fails.
//
// This is the guarantee JIN-128 is about: devpod's own INACTIVITY_TIMEOUT
// watchdog reset only fires from a background goroutine on a 30s
// time.After tick (confirmed against devpod's pkg/tunnel/container.go --
// there is no reset-on-connect), so a session that closes before that tick
// resets nothing. The old script opened and tore down one short-lived
// tunnel per bootstrap step, so whether any reset happened at all
// depended entirely on some step incidentally taking >=30s wall-clock.
// KeepAlive removes that dependency: the session is held open at least
// minDuration no matter how fast (or how badly) the bootstrap sequence
// itself goes.
func KeepAlive(
	ctx context.Context,
	clock Clock,
	tunnel Tunnel,
	minDuration time.Duration,
	steps func(ctx context.Context, tunnel Tunnel) error,
) error {
	start := clock.Now()
	if err := tunnel.Open(ctx); err != nil {
		return fmt.Errorf("open tunnel: %w", err)
	}

	stepsErr := steps(ctx, tunnel)

	if remaining := minDuration - clock.Now().Sub(start); remaining > 0 {
		clock.Sleep(ctx, remaining)
	}

	closeErr := tunnel.Close()
	if stepsErr != nil {
		return stepsErr
	}
	return closeErr
}
