// Package devpodtunnel is the real core.Tunnel implementation for
// devpod-keepalive (JIN-131): one long-lived `devpod ssh <workspace>`
// process held open for the whole keepalive run, in place of the old
// pattern of a separate one-shot `devpod ssh --command` tunnel per
// bootstrap step (gce_common_ssh_step in gce-common.sh).
//
// This talks to devpod purely as a subprocess over stdin/stdout, not via
// devpod's own Go client packages (pkg/client, pkg/tunnel). Those packages
// are importable (they live under a public, non-"internal" path), but
// pulling them in drags k8s.io/client-go, k8s.io/apiserver,
// sigs.k8s.io/controller-runtime and k8s.io/kubectl into this module --
// confirmed by hand (`go get github.com/loft-sh/devpod@latest` in a scratch
// module) -- a dependency footprint wildly disproportionate to "hold a
// shell open and run five scripts" for a module that otherwise only
// depends on Dagger's own SDK and OTel. The guarantee JIN-128 actually
// needs -- one session held open past devpod's 30s watchdog tick -- is met
// either way; which mechanism opens that session is an implementation
// detail behind the core.Tunnel interface JIN-130 defined for exactly this
// reason. If devpod's client packages become a lighter dependency in the
// future, swapping this package out is a Tunnel-shaped change, not a
// KeepAlive/retry-shaped one.
package devpodtunnel

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// defaultScriptsDir matches DEVENV_BASE_DEVCONTAINER_DIR's default in
// gce-common.sh: where the agent-plugins clone puts the bootstrap scripts
// on the remote box.
const defaultScriptsDir = ".dagger/internal/devenv-base/.devcontainer"

// doneMarkerPrefix delimits a step's output from its exit code on the
// shared stdout stream. Run writes `<cmd>; echo <marker><exit-code>` and
// scans for a line with this prefix to know the step finished and to
// recover its real exit code -- devpod ssh's own exit code is documented
// (see gce-common.sh) as unreliable through a cosmetic tunnel-teardown
// error, but that only affects the *session's* exit code, not a command
// run over it, so this sidesteps the problem entirely rather than
// classifying around it.
const doneMarkerPrefix = "__DEVPOD_KEEPALIVE_STEP_DONE__"

// Tunnel implements core.Tunnel (the interface itself lives in the core
// package, which devpodtunnel deliberately does not import, keeping this
// package's own dependency graph -- just os/exec and bufio -- independent
// of it). Safe for the sequential Open/Run/Restart/Close usage KeepAlive
// drives; not designed for concurrent Run calls.
type Tunnel struct {
	Workspace string
	// ScriptsDir overrides defaultScriptsDir -- exposed for tests, which
	// point it at a scratch directory of fake scripts rather than a real
	// repo checkout on a real remote box.
	ScriptsDir string

	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
}

// New returns a Tunnel for workspace, not yet open.
func New(workspace string) *Tunnel {
	return &Tunnel{Workspace: workspace}
}

func (t *Tunnel) scriptsDir() string {
	if t.ScriptsDir != "" {
		return t.ScriptsDir
	}
	return defaultScriptsDir
}

// Open starts `devpod ssh <workspace>` and holds it open (no --command:
// that flag runs one remote command and tears the session down, exactly
// the per-step pattern this package replaces).
func (t *Tunnel) Open(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.openLocked(ctx)
}

func (t *Tunnel) openLocked(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "devpod", "ssh", t.Workspace)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("devpod ssh stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("devpod ssh stdout pipe: %w", err)
	}
	// Combine stdout+stderr onto the one stream Run scans for the done
	// marker, matching gce_common_ssh_step's `2>&1` precedent -- callers
	// there already expect one combined stream per step.
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("devpod ssh %s: %w", t.Workspace, err)
	}
	t.cmd = cmd
	t.stdin = stdin
	t.stdout = bufio.NewReader(stdout)
	return nil
}

// Run executes one bootstrap step as a remote command over the open
// session and blocks until it completes, returning its combined
// stdout/stderr and a non-nil error iff its own exit code was non-zero.
func (t *Tunnel) Run(ctx context.Context, script string, extraEnv ...string) (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stdin == nil {
		return "", fmt.Errorf("devpodtunnel: Run called before Open (or after Close)")
	}

	var envPrefix strings.Builder
	for _, kv := range extraEnv {
		envPrefix.WriteString(shQuoteEnv(kv))
		envPrefix.WriteByte(' ')
	}
	cmdLine := fmt.Sprintf("%sbash %s/%s; echo %s$?\n", envPrefix.String(), t.scriptsDir(), script, doneMarkerPrefix)
	if _, err := io.WriteString(t.stdin, cmdLine); err != nil {
		return "", fmt.Errorf("write %s to devpod ssh session: %w", script, err)
	}

	var out strings.Builder
	for {
		line, readErr := t.stdout.ReadString('\n')
		if line != "" {
			trimmed := strings.TrimRight(line, "\r\n")
			if strings.HasPrefix(trimmed, doneMarkerPrefix) {
				codeStr := strings.TrimPrefix(trimmed, doneMarkerPrefix)
				code, perr := strconv.Atoi(codeStr)
				if perr != nil {
					return out.String(), fmt.Errorf("%s: parse exit marker %q: %w", script, trimmed, perr)
				}
				if code != 0 {
					return out.String(), fmt.Errorf("%s exited %d", script, code)
				}
				return out.String(), nil
			}
			out.WriteString(line)
		}
		if readErr != nil {
			return out.String(), fmt.Errorf("devpod ssh session ended before %s completed: %w", script, readErr)
		}
	}
}

// shQuoteEnv turns a "KEY=value" pair into `KEY='value'` with value
// single-quote-escaped, safe to splice into the remote command line.
func shQuoteEnv(kv string) string {
	i := strings.IndexByte(kv, '=')
	if i < 0 {
		return kv
	}
	key, val := kv[:i], kv[i+1:]
	return key + "=" + "'" + strings.ReplaceAll(val, "'", `'\''`) + "'"
}

// Restart recovers a stopped/missing workspace: runs `devpod up` (its own
// process, not a command over the ssh session -- devpod-keepalive.sh's
// original comments note `devpod up` brings the workspace back in a fresh
// container, so the pre-restart session is dead either way) and then opens
// a fresh session.
func (t *Tunnel) Restart(ctx context.Context) error {
	t.mu.Lock()
	t.closeLocked()
	t.mu.Unlock()

	cmd := exec.CommandContext(ctx, "devpod", "up", t.Workspace)
	var out strings.Builder
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("devpod up %s: %w: %s", t.Workspace, err, out.String())
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	return t.openLocked(ctx)
}

// Close tears down the session.
func (t *Tunnel) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closeLocked()
	return nil
}

func (t *Tunnel) closeLocked() {
	if t.stdin != nil {
		_ = t.stdin.Close()
	}
	if t.cmd != nil && t.cmd.Process != nil {
		// devpod ssh's known cosmetic tunnel-teardown error (see
		// devpod-keepalive.sh's header comment) routinely makes the
		// session process itself exit non-zero even when every step run
		// over it succeeded -- Run already reports each step's own real
		// exit code separately via the done marker, so that's not
		// swallowing a real failure here, just not double-reporting a
		// known-cosmetic one.
		_ = t.cmd.Wait()
	}
	t.cmd = nil
	t.stdin = nil
	t.stdout = nil
}
