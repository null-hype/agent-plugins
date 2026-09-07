package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"

	"github.com/alessio/shellescape"
	"github.com/loft-sh/log"
)

type containerCommand func(context.Context, string, map[string]string) ([]byte, error)

func (w *devpodWorkspace) Bootstrap(ctx context.Context) error {
	dir := os.Getenv("DEVENV_BASE_DEVCONTAINER_DIR")
	if dir == "" {
		dir = ".dagger/internal/devenv-base/.devcontainer"
	}
	return bootstrap(ctx, w.runContainer, dir, os.Getenv("PROTON_PASS_PERSONAL_ACCESS_TOKEN"))
}

func bootstrap(ctx context.Context, run containerCommand, dir, token string) error {
	if token == "" {
		return fmt.Errorf("PROTON_PASS_PERSONAL_ACCESS_TOKEN is required for container bootstrap")
	}
	script := func(name string, env map[string]string) error {
		log.Default.Infof("keepalive: bootstrap %s", name)
		out, err := run(ctx, "bash "+shellescape.Quote(path.Join(dir, name)), env)
		if len(out) > 0 {
			fmt.Fprint(os.Stdout, string(out))
		}
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		return nil
	}
	if err := script("generate-env-files.sh", nil); err != nil {
		return err
	}
	if err := script("tailscale-up.sh", map[string]string{"PROTON_PASS_PERSONAL_ACCESS_TOKEN": token}); err != nil {
		return err
	}
	out, err := run(ctx, `if [ "$(id -u)" = 0 ]; then tailscale status --json; else sudo tailscale status --json; fi`, nil)
	if err != nil {
		return fmt.Errorf("read Tailscale status: %w", err)
	}
	if err := checkTailnet(out); err != nil {
		return err
	}
	if err := script("install-tools.sh", nil); err != nil {
		return err
	}
	// These existing scripts reuse the running processes. Never stop or restart
	// the agent: it may already be serving requests in this environment.
	if err := script("start-linear-agent.sh", nil); err != nil {
		return err
	}
	if err := checkAgent(ctx, run, "http://127.0.0.1:8080/healthz"); err != nil {
		return err
	}
	if err := script("start-cloudflared.sh", nil); err != nil {
		return err
	}
	if err := checkAgent(ctx, run, "https://agent.tidelands.dev/healthz"); err != nil {
		return err
	}
	return script("check-linear-agent-webhook-live.sh", nil)
}

func checkTailnet(out []byte) error {
	var state struct {
		BackendState string
		Self         *struct {
			Online       bool
			DNSName      string
			TailscaleIPs []string
		}
	}
	if err := json.Unmarshal(out, &state); err != nil {
		return fmt.Errorf("decode Tailscale status: %w", err)
	}
	if state.BackendState != "Running" || state.Self == nil || !state.Self.Online || len(state.Self.TailscaleIPs) == 0 {
		return fmt.Errorf("Tailscale is not online (backend=%s)", state.BackendState)
	}
	log.Default.Infof("keepalive: tailnet online name=%s", state.Self.DNSName)
	return nil
}

func checkAgent(ctx context.Context, run containerCommand, url string) error {
	out, err := run(ctx, "curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 2 --max-time 10 "+shellescape.Quote(url), nil)
	if err != nil {
		return fmt.Errorf("Linear agent health %s: %w", url, err)
	}
	var health struct {
		InstallTokenConfigured bool `json:"installTokenConfigured"`
	}
	if err := json.Unmarshal(out, &health); err != nil {
		return fmt.Errorf("decode Linear agent health %s: %w", url, err)
	}
	if !health.InstallTokenConfigured {
		return fmt.Errorf("Linear agent at %s has no install token", url)
	}
	log.Default.Infof("keepalive: Linear agent healthy url=%s", url)
	return nil
}
