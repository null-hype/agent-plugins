// Package retry ports devpod-keepalive.sh's retry/state-machine logic
// (tailscale down -> `devpod up` -> retry tailscale -> fail) off stdout
// substring-grepping onto typed classification of a core.Tunnel's results
// (JIN-132). The per-step tolerate/fail policy is otherwise unchanged from
// the shell version -- see RunBootstrap.
package retry

import (
	"context"
	"fmt"
	"strings"

	"dagger/devenv-base/keepalive/core"
)

// TailscaleOutcome classifies tailscale-up.sh's result. devpod ssh's exit
// code alone can't distinguish these: it routinely exits non-zero on a
// known cosmetic tunnel-teardown error even when the remote command
// actually succeeded (see devpod-keepalive.sh's original comments), so a
// non-nil Tunnel.Run error has to be classified by inspecting output, not
// treated as failure outright.
type TailscaleOutcome int

const (
	// TailscaleSuccess: either Run's own error was nil, or the output
	// carries tailscale-up.sh's own success line despite a non-nil error
	// (the cosmetic-teardown case).
	TailscaleSuccess TailscaleOutcome = iota
	// TailscaleWorkspaceStopped: the workspace is stopped or no longer
	// exists -- recoverable via Tunnel.Restart.
	TailscaleWorkspaceStopped
	// TailscaleFailure: neither of the above -- e.g. an actual tailscale
	// login/join failure. Note this is tolerated (not retried) on the
	// *first* attempt, matching the shell script: a later step (typically
	// start-linear-agent.sh, which needs the pass-cli session
	// tailscale-up.sh establishes) is what actually catches a genuinely
	// broken run. It is only fatal here on the post-Restart attempt --
	// see RunBootstrap.
	TailscaleFailure
)

// ClassifyTailscaleUp turns tailscale-up.sh's (output, err) into a
// TailscaleOutcome.
func ClassifyTailscaleUp(output string, err error) TailscaleOutcome {
	if err == nil {
		return TailscaleSuccess
	}
	lower := strings.ToLower(output)
	if strings.Contains(lower, "workspace is stopped") ||
		strings.Contains(lower, "doesnt exist") ||
		strings.Contains(lower, "does not exist") {
		return TailscaleWorkspaceStopped
	}
	// tailscale-up.sh's own success lines, checked verbatim (not
	// lowercased) to match the shell script's original grep exactly.
	if strings.Contains(output, "tailscale: already connected") ||
		strings.Contains(output, "tailscale: joined tailnet") {
		return TailscaleSuccess
	}
	return TailscaleFailure
}

// Deps are the pieces RunBootstrap needs beyond the tunnel itself.
type Deps struct {
	// ProtonPassToken is passed to tailscale-up.sh as
	// PROTON_PASS_PERSONAL_ACCESS_TOKEN -- the only step that logs in (see
	// devpod-keepalive.sh's ssh_tailscale_up comment: every later step just
	// calls `pass-cli run` against the session this one leaves behind).
	ProtonPassToken string
	// Log receives one line per notable event, mirroring the shell
	// script's echo statements. Nil discards.
	Log func(format string, args ...any)
}

func (d Deps) log(format string, args ...any) {
	if d.Log != nil {
		d.Log(format, args...)
	}
}

// RunBootstrap runs the five bootstrap steps over tunnel (already open --
// RunBootstrap is meant to be called as the `steps` func core.KeepAlive
// invokes). Per-step policy, unchanged from devpod-keepalive.sh:
//
//   - generate-env-files.sh: always tolerated (a harmless no-op re-run on
//     an already-warm container).
//   - tailscale-up.sh: classified via ClassifyTailscaleUp. A
//     TailscaleWorkspaceStopped result triggers tunnel.Restart (`devpod
//     up`) followed by one retry of generate-env-files.sh and
//     tailscale-up.sh; if that retry still isn't TailscaleSuccess,
//     RunBootstrap fails the whole run here rather than silently
//     proceeding into steps that would fail anyway with no pass-cli
//     session (the "new container has no pass-cli session" failure mode
//     devpod-keepalive.sh's comments describe). A first-attempt
//     TailscaleFailure (not workspace-stopped) is tolerated, same as the
//     shell script -- start-linear-agent.sh below is what actually catches
//     a genuinely broken session.
//   - install-tools.sh: always tolerated.
//   - start-linear-agent.sh, start-cloudflared.sh: must succeed, or
//     RunBootstrap fails the run -- these are the steps that actually keep
//     the app reachable.
func RunBootstrap(ctx context.Context, tunnel core.Tunnel, deps Deps) error {
	runTolerated := func(script string) {
		out, err := tunnel.Run(ctx, script)
		deps.log("%s", out)
		if err != nil {
			deps.log("devpod ssh exited non-zero on %s (likely the known cosmetic tunnel-teardown error on exit) -- continuing: %v", script, err)
		}
	}

	runTailscaleUp := func() (string, error) {
		return tunnel.Run(ctx, "tailscale-up.sh", "PROTON_PASS_PERSONAL_ACCESS_TOKEN="+deps.ProtonPassToken)
	}

	runTolerated("generate-env-files.sh")

	tsOut, tsErr := runTailscaleUp()
	deps.log("%s", tsOut)

	switch ClassifyTailscaleUp(tsOut, tsErr) {
	case TailscaleSuccess:
		// continue below

	case TailscaleWorkspaceStopped:
		deps.log("workspace was stopped -- restarting with devpod up")
		if err := tunnel.Restart(ctx); err != nil {
			return fmt.Errorf("devpod up: %w", err)
		}

		runTolerated("generate-env-files.sh")

		tsOut, tsErr = runTailscaleUp()
		deps.log("%s", tsOut)
		if ClassifyTailscaleUp(tsOut, tsErr) != TailscaleSuccess {
			return fmt.Errorf(
				"tailscale-up.sh did not complete after devpod up -- the new container has no pass-cli session, so every later step would fail on \"No active session\": %w",
				tsErr,
			)
		}

	case TailscaleFailure:
		deps.log("devpod ssh exited non-zero on tailscale-up.sh (likely the known cosmetic tunnel-teardown error on exit) -- continuing")
	}

	runTolerated("install-tools.sh")

	agentOut, agentErr := tunnel.Run(ctx, "start-linear-agent.sh")
	deps.log("%s", agentOut)

	cfOut, cfErr := tunnel.Run(ctx, "start-cloudflared.sh")
	deps.log("%s", cfOut)

	if agentErr != nil {
		return fmt.Errorf("start-linear-agent.sh failed -- this is the step that actually keeps the app reachable: %w", agentErr)
	}
	if cfErr != nil {
		return fmt.Errorf("start-cloudflared.sh failed -- agent.tidelands.dev is not publicly reachable without it: %w", cfErr)
	}
	return nil
}
