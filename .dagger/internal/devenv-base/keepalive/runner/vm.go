package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/alessio/shellescape"
	"github.com/loft-sh/devpod/pkg/client"
	"github.com/loft-sh/log"
)

const vmService = "devenv-vm-tailscale"
const vmStatusCommand = "sudo docker exec " + vmService + " tailscale status --json"
const containerStatusCommand = `if [ "$(id -u)" = 0 ]; then tailscale status --json; else sudo tailscale status --json; fi`

type tailnetState struct {
	BackendState string
	Self         *struct {
		ID           string
		Online       bool
		DNSName      string
		TailscaleIPs []string
	}
}

func decodeTailnet(out []byte) (*tailnetState, error) {
	var state tailnetState
	if err := json.Unmarshal(out, &state); err != nil {
		return nil, fmt.Errorf("decode Tailscale status: %w", err)
	}
	return &state, nil
}

func distinctNodes(vm, container *tailnetState) error {
	for role, state := range map[string]*tailnetState{"VM": vm, "devcontainer": container} {
		if state == nil || state.BackendState != "Running" || state.Self == nil || !state.Self.Online || state.Self.ID == "" || len(state.Self.TailscaleIPs) == 0 {
			return fmt.Errorf("%s tailnet node is not online with a stable identity", role)
		}
	}
	if vm.Self.ID == container.Self.ID {
		return fmt.Errorf("VM and devcontainer share Tailscale node ID %s", vm.Self.ID)
	}
	for _, a := range vm.Self.TailscaleIPs {
		for _, b := range container.Self.TailscaleIPs {
			if a == b {
				return fmt.Errorf("VM and devcontainer share Tailscale IP %s", a)
			}
		}
	}
	return nil
}

func (w *devpodWorkspace) machineCommand(ctx context.Context, command string, stdin io.Reader) ([]byte, error) {
	const marker = "DEVPOD_MACHINE_COMMAND_OK\n"
	var out bytes.Buffer
	err := w.client.Command(ctx, client.CommandOptions{Command: "(" + command + ") && printf " + shellescape.Quote(marker), Stdin: stdin, Stdout: &out, Stderr: os.Stderr})
	if err != nil {
		return nil, err
	}
	if !strings.HasSuffix(out.String(), marker) {
		return nil, fmt.Errorf("machine command did not acknowledge completion")
	}
	return []byte(strings.TrimSuffix(out.String(), marker)), nil
}

// The archive is built by this Dagger module, shipped with the runner, and
// loaded only when its content-addressed image is missing from the VM.
func (w *devpodWorkspace) ensureVMTailnet(ctx context.Context) error {
	archive := os.Getenv("VM_TAILSCALE_ARCHIVE")
	if archive == "" {
		archive = "/opt/devenv/vm-tailscale.tar"
	}
	f, err := os.Open(archive)
	if err != nil {
		return fmt.Errorf("open Dagger VM image: %w", err)
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return err
	}
	image := "devenv-vm-tailscale:" + hex.EncodeToString(h.Sum(nil))
	out, err := w.machineCommand(ctx, "sudo docker image ls --format '{{.ID}}' --filter reference="+shellescape.Quote(image), nil)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(out)) == "" {
		log.Default.Info("keepalive: loading Dagger-built VM Tailscale image")
		if _, err = f.Seek(0, io.SeekStart); err != nil {
			return err
		}
		out, err = w.machineCommand(ctx, "sudo docker load --quiet", f)
		if err != nil {
			return err
		}
		id := regexp.MustCompile(`Loaded image ID: (sha256:[a-f0-9]{64})`).FindSubmatch(out)
		if len(id) != 2 {
			return fmt.Errorf("Docker did not report a single loaded image ID")
		}
		if _, err = w.machineCommand(ctx, "sudo docker tag "+string(id[1])+" "+shellescape.Quote(image), nil); err != nil {
			return err
		}
	}
	out, err = w.machineCommand(ctx, "sudo docker container ls -a --filter name=^/"+vmService+"$ --format '{{.ID}}'", nil)
	if err != nil {
		return err
	}
	exists := strings.TrimSpace(string(out)) != ""
	if exists {
		out, err = w.machineCommand(ctx, "sudo docker inspect "+vmService, nil)
		if err != nil {
			return err
		}
		var services []struct {
			Config struct {
				Image  string
				Labels map[string]string
			}
			HostConfig struct {
				NetworkMode   string
				RestartPolicy struct{ Name string }
			}
		}
		if err = json.Unmarshal(out, &services); err != nil {
			return err
		}
		if len(services) != 1 || services[0].Config.Labels["dev.devenv.owner"] != "keepalive" {
			return fmt.Errorf("refusing to replace unmanaged %s container", vmService)
		}
		s := services[0]
		if s.Config.Image != image || s.HostConfig.NetworkMode != "host" || s.HostConfig.RestartPolicy.Name != "always" {
			if _, err = w.machineCommand(ctx, "sudo docker rm -f "+vmService, nil); err != nil {
				return err
			}
			exists = false
		}
	}
	if !exists {
		command := "sudo docker run -d --name " + vmService + " --label dev.devenv.owner=keepalive --restart=always --network=host --cap-add=NET_ADMIN --cap-add=NET_RAW --device=/dev/net/tun --mount type=volume,src=devenv-vm-tailscale-state,dst=/var/lib/tailscale " + shellescape.Quote(image)
		if _, err = w.machineCommand(ctx, command, nil); err != nil {
			return err
		}
	} else {
		if _, err = w.machineCommand(ctx, "sudo docker start "+vmService, nil); err != nil {
			return err
		}
	}
	// Wait for the daemon's socket, not an arbitrary sleep or a process name.
	if _, err = w.machineCommand(ctx, "sudo docker exec "+vmService+" sh -c "+shellescape.Quote("for i in $(seq 1 30); do test ! -S /var/run/tailscale/tailscaled.sock || exit 0; sleep 1; done; exit 1"), nil); err != nil {
		return fmt.Errorf("VM Tailscale daemon readiness: %w", err)
	}
	out, err = w.machineCommand(ctx, vmStatusCommand, nil)
	if err != nil {
		return err
	}
	state, err := decodeTailnet(out)
	if err != nil {
		return err
	}
	if state.BackendState != "Running" || state.Self == nil || !state.Self.Online {
		token := os.Getenv("TS_AUTHKEY")
		if token == "" {
			return fmt.Errorf("TS_AUTHKEY is required to join the VM to the tailnet")
		}
		command := "sudo docker exec -i " + vmService + " tailscale up --auth-key=file:/dev/stdin --hostname=" + shellescape.Quote(w.client.Workspace()+"-vm") + " --accept-dns=false --timeout=60s"
		if _, err = w.machineCommand(ctx, command, strings.NewReader(token)); err != nil {
			return fmt.Errorf("join VM tailnet: %w", err)
		}
	}
	return nil
}

func (w *devpodWorkspace) verifyTailnets(ctx context.Context) error {
	// Control-plane Online can lag tailscale up briefly. All reads and retries
	// remain inside the job deadline; persistent offline state fails the job.
	deadline := time.NewTimer(30 * time.Second)
	defer deadline.Stop()
	for {
		a, err := w.machineCommand(ctx, vmStatusCommand, nil)
		if err != nil {
			return err
		}
		b, err := w.runContainer(ctx, containerStatusCommand, nil)
		if err != nil {
			return err
		}
		vm, err := decodeTailnet(a)
		if err != nil {
			return err
		}
		container, err := decodeTailnet(b)
		if err != nil {
			return err
		}
		err = distinctNodes(vm, container)
		if err == nil {
			log.Default.Infof("keepalive: two tailnet nodes verified VM=%s IPs=%v devcontainer=%s IPs=%v", vm.Self.DNSName, vm.Self.TailscaleIPs, container.Self.DNSName, container.Self.TailscaleIPs)
			return nil
		}
		if vm.Self != nil && container.Self != nil && vm.Self.ID != "" && vm.Self.ID == container.Self.ID {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return err
		case <-time.After(time.Second):
		}
	}
}
