// Command keepalivecore is the compiled entrypoint for the tunnel/timing
// core of devpod-keepalive (JIN-128/JIN-133): it holds one long-lived
// devpod ssh session open for the whole bootstrap sequence, guarantees that
// session outlives devpod's 30s watchdog-reset tick, and drives the
// tailscale retry state machine -- replacing the equivalent inline bash in
// devpod-keepalive.sh (ssh_tailscale_up and the retry dance around it, plus
// the five separate `gce_common_ssh_step` calls).
//
// Deliberately does NOT touch secrets, pass-cli, or the restic
// pull/push-devpod-state dance: those stay in devpod-keepalive.sh, which
// invokes this binary only for the tunnel/retry portion of a run, after
// gce_common_restic_pull_devpod_state and before
// gce_common_restic_push_devpod_state.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"dagger/devenv-base/keepalive/core"
	"dagger/devenv-base/keepalive/devpodtunnel"
	"dagger/devenv-base/keepalive/retry"
)

// minSessionDuration is how long KeepAlive holds the devpod ssh session
// open regardless of how fast the bootstrap sequence itself runs. Set with
// margin over devpod's 30s watchdog-reset tick (confirmed against devpod's
// pkg/tunnel/container.go: `time.After(30 * time.Second)`, no
// reset-on-connect) -- 45s comfortably clears jitter around that boundary,
// and sits trivially inside devpod-keepalive.sh's existing 30m wall-clock
// cap.
const minSessionDuration = 45 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	workspaceID := os.Getenv("WORKSPACE_ID")
	if workspaceID == "" {
		return fmt.Errorf("WORKSPACE_ID must be set")
	}
	protonPassToken := os.Getenv("PROTON_PASS_PERSONAL_ACCESS_TOKEN")
	if protonPassToken == "" {
		return fmt.Errorf("PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set")
	}

	tunnel := devpodtunnel.New(workspaceID)
	if scriptsDir := os.Getenv("DEVENV_BASE_DEVCONTAINER_DIR"); scriptsDir != "" {
		tunnel.ScriptsDir = scriptsDir
	}

	deps := retry.Deps{
		ProtonPassToken: protonPassToken,
		Log: func(format string, args ...any) {
			fmt.Fprintf(os.Stdout, format+"\n", args...)
		},
	}
	steps := func(ctx context.Context, tun core.Tunnel) error {
		return retry.RunBootstrap(ctx, tun, deps)
	}

	// Bare context, not tied to a signal handler: devpod-keepalive.sh
	// already wraps the whole run in `timeout --signal=TERM --kill-after
	// 30m`, which is the process-level cap this binary runs under -- no
	// need to duplicate that here.
	return core.KeepAlive(context.Background(), core.RealClock{}, tunnel, minSessionDuration, steps)
}
