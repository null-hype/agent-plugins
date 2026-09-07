package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path"
	"strings"
	"sync/atomic"

	"github.com/alessio/shellescape"
	devcmd "github.com/loft-sh/devpod/cmd"
	"github.com/loft-sh/devpod/cmd/flags"
	"github.com/loft-sh/devpod/pkg/client"
	"github.com/loft-sh/devpod/pkg/config"
	"github.com/loft-sh/devpod/pkg/provider"
	devssh "github.com/loft-sh/devpod/pkg/ssh"
	"github.com/loft-sh/devpod/pkg/tunnel"
	devworkspace "github.com/loft-sh/devpod/pkg/workspace"
	"github.com/loft-sh/log"
	"golang.org/x/crypto/ssh"
)

type devpodWorkspace struct {
	config *config.Config
	client client.WorkspaceClient
}

func loadWorkspace(ctx context.Context, id string) (*devpodWorkspace, error) {
	if id == "" {
		return nil, fmt.Errorf("workspace ID is required")
	}
	cfg, err := config.LoadConfig("", "")
	if err != nil {
		return nil, fmt.Errorf("load DevPod config: %w", err)
	}
	// Get loads an existing mapping; Resolve (used by the CLI up command)
	// can interpret a missing workspace as a source and create a new mapping.
	base, err := devworkspace.Get(ctx, cfg, []string{id}, false, log.Default.ErrorStreamOnly())
	if err != nil {
		return nil, fmt.Errorf("load existing workspace %q: %w", id, err)
	}
	w, ok := base.(client.WorkspaceClient)
	if !ok {
		return nil, fmt.Errorf("workspace %q uses unsupported client %T", id, base)
	}
	log.Default.Infof("keepalive: workspace=%s provider=%s", w.Workspace(), w.Provider())
	return &devpodWorkspace{config: cfg, client: w}, nil
}

func (w *devpodWorkspace) Up(ctx context.Context) error {
	// Restored provider options can contain expired credentials. This is
	// normally performed by the CLI's workspace.Resolve before Up.Run.
	if err := w.client.RefreshOptions(ctx, nil, false); err != nil {
		return fmt.Errorf("refresh provider options: %w", err)
	}
	up := &devcmd.UpCmd{
		GlobalFlags: &flags.GlobalFlags{Context: w.client.Context()},
		CLIOptions:  provider.CLIOptions{IDE: "none"},
	}
	return up.Run(ctx, w.config, w.client, log.Default.ErrorStreamOnly())
}

func (w *devpodWorkspace) Status(ctx context.Context) (client.Status, error) {
	return w.client.Status(ctx, client.StatusOptions{ContainerStatus: true})
}

func (w *devpodWorkspace) Probe(ctx context.Context) error {
	ws := w.client.WorkspaceConfig()
	command := "test \"${DEVPOD:-}\" = true && test \"${DEVPOD_WORKSPACE_ID:-}\" = " + shellescape.Quote(ws.ID) +
		" && test \"${DEVPOD_WORKSPACE_UID:-}\" = " + shellescape.Quote(ws.UID) +
		" && printf 'DEVPOD_KEEPALIVE_CONTAINER_OK\\n'"
	var completed atomic.Bool
	err := tunnel.NewContainerTunnel(w.client, false, log.Default.ErrorStreamOnly()).Run(ctx,
		func(ctx context.Context, conn *ssh.Client) error {
			var out bytes.Buffer
			if err := devssh.Run(ctx, conn, command, nil, &out, os.Stderr, nil); err != nil {
				return err
			}
			if strings.TrimSpace(out.String()) != "DEVPOD_KEEPALIVE_CONTAINER_OK" {
				return fmt.Errorf("container did not acknowledge probe")
			}
			completed.Store(true)
			return nil
		}, w.config, nil)
	if err != nil {
		return err
	}
	// The upstream tunnel selects between transport and handler completion.
	// A transport returning nil before the handler ran is not probe success.
	if !completed.Load() {
		return fmt.Errorf("tunnel closed before container acknowledged probe")
	}
	return nil
}

// Each bootstrap step has its own tunnel and must both exit successfully and
// acknowledge completion. Upstream transport teardown alone is not success.
func (w *devpodWorkspace) runContainer(ctx context.Context, command string, env map[string]string) ([]byte, error) {
	const marker = "DEVPOD_KEEPALIVE_STEP_OK\n"
	var out bytes.Buffer
	var completed atomic.Bool
	err := tunnel.NewContainerTunnel(w.client, false, log.Default.ErrorStreamOnly()).Run(ctx,
		func(ctx context.Context, conn *ssh.Client) error {
			command = "export PATH=\"$HOME/.local/bin:$PATH\"; cd " + shellescape.Quote(path.Join("/workspaces", w.client.Workspace())) + " && bash -c " + shellescape.Quote(command) + " && printf " + shellescape.Quote(marker)
			if err := devssh.Run(ctx, conn, command, nil, &out, os.Stderr, env); err != nil {
				return err
			}
			if !strings.HasSuffix(out.String(), marker) {
				return fmt.Errorf("container did not acknowledge bootstrap step")
			}
			completed.Store(true)
			return nil
		}, w.config, nil)
	if err != nil {
		return nil, err
	}
	if !completed.Load() {
		return nil, fmt.Errorf("tunnel closed before bootstrap step completed")
	}
	return []byte(strings.TrimSuffix(out.String(), marker)), nil
}

func (w *devpodWorkspace) RefreshActivity(ctx context.Context) error {
	encoded, info, err := w.client.AgentInfo(provider.CLIOptions{})
	if err != nil {
		return err
	}
	command := shellescape.Quote(w.client.AgentPath()) + " agent workspace update-config --workspace-info " + shellescape.Quote(encoded)
	if info.Agent.DataPath != "" {
		command += " --agent-dir " + shellescape.Quote(info.Agent.DataPath)
	}
	command += " && printf 'DEVPOD_KEEPALIVE_ACTIVITY_OK\\n'"
	var out bytes.Buffer
	if err := w.client.Command(ctx, client.CommandOptions{Command: command, Stdout: &out, Stderr: os.Stderr}); err != nil {
		return err
	}
	if strings.TrimSpace(out.String()) != "DEVPOD_KEEPALIVE_ACTIVITY_OK" {
		return fmt.Errorf("agent did not acknowledge activity update")
	}
	return nil
}
