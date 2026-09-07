package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/loft-sh/devpod/pkg/client"
)

func TestDistinctTailnetNodes(t *testing.T) {
	parse := func(raw string) *tailnetState {
		s, e := decodeTailnet([]byte(raw))
		if e != nil {
			t.Fatal(e)
		}
		return s
	}
	vm := parse(`{"BackendState":"Running","Self":{"ID":"vm","Online":true,"TailscaleIPs":["100.64.0.1"]}}`)
	for _, tc := range []struct {
		name, raw string
		ok        bool
	}{
		{"distinct", `{"BackendState":"Running","Self":{"ID":"container","Online":true,"TailscaleIPs":["100.64.0.2"]}}`, true},
		{"same identity", `{"BackendState":"Running","Self":{"ID":"vm","Online":true,"TailscaleIPs":["100.64.0.2"]}}`, false},
		{"same address", `{"BackendState":"Running","Self":{"ID":"container","Online":true,"TailscaleIPs":["100.64.0.1"]}}`, false},
		{"offline", `{"BackendState":"Running","Self":{"ID":"container","Online":false,"TailscaleIPs":["100.64.0.2"]}}`, false},
		{"missing identity", `{"BackendState":"Running","Self":{"Online":true,"TailscaleIPs":["100.64.0.2"]}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := distinctNodes(vm, parse(tc.raw)); (err == nil) != tc.ok {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

type machineTestClient struct {
	client.WorkspaceClient
	t       *testing.T
	fresh   bool
	managed bool
	fail    string
	calls   []string
}

func (c *machineTestClient) Workspace() string { return "test-workspace" }
func (c *machineTestClient) Command(_ context.Context, o client.CommandOptions) error {
	c.calls = append(c.calls, o.Command)
	if strings.Contains(o.Command, "test-secret") {
		c.t.Fatal("auth key exposed in command")
	}
	if c.fail != "" && strings.Contains(o.Command, c.fail) {
		return errors.New("machine failed")
	}
	output := ""
	switch {
	case strings.Contains(o.Command, "docker image ls"):
		if !c.fresh {
			output = "image-id\n"
		}
	case strings.Contains(o.Command, "docker load"):
		b, _ := io.ReadAll(o.Stdin)
		if string(b) != "test-archive" {
			c.t.Fatal("archive not streamed")
		}
		output = "Loaded image ID: sha256:" + strings.Repeat("a", 64) + "\n"
	case strings.Contains(o.Command, "docker container ls"):
		if !c.fresh {
			output = "container-id\n"
		}
	case strings.Contains(o.Command, "docker inspect"):
		// A foreign container must be rejected, never removed or reused.
		output = `[{"Config":{"Labels":{}}}]`
		if c.managed {
			output = fmt.Sprintf(`[{"Config":{"Image":"devenv-vm-tailscale:%x","Labels":{"dev.devenv.owner":"keepalive"}},"HostConfig":{"NetworkMode":"host","RestartPolicy":{"Name":"always"}}}]`, sha256.Sum256([]byte("test-archive")))
		}
	case strings.Contains(o.Command, "tailscale status"):
		output = `{"BackendState":"NeedsLogin"}`
		if c.managed {
			output = `{"BackendState":"Running","Self":{"Online":true}}`
		}
	case strings.Contains(o.Command, "tailscale up"):
		b, _ := io.ReadAll(o.Stdin)
		if string(b) != "test-secret" {
			c.t.Fatal("auth key not streamed")
		}
	}
	_, err := io.WriteString(o.Stdout, output+"DEVPOD_MACHINE_COMMAND_OK\n")
	return err
}

func TestVMProvisioning(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "image.tar")
	if err := os.WriteFile(archive, []byte("test-archive"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VM_TAILSCALE_ARCHIVE", archive)
	t.Setenv("TS_AUTHKEY", "test-secret")
	c := &machineTestClient{t: t, fresh: true}
	if err := (&devpodWorkspace{client: c}).ensureVMTailnet(context.Background()); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(c.calls, "\n")
	for _, required := range []string{"--network=host", "--restart=always", "src=devenv-vm-tailscale-state", "--auth-key=file:/dev/stdin", "--hostname=test-workspace-vm"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing %s", required)
		}
	}
	if strings.Contains(joined, "--ssh") {
		t.Fatal("VM service must leave host sshd in charge of SSH")
	}
	c = &machineTestClient{t: t, fresh: false}
	if err := (&devpodWorkspace{client: c}).ensureVMTailnet(context.Background()); err == nil || !strings.Contains(err.Error(), "unmanaged") {
		t.Fatalf("expected ownership failure, got %v", err)
	}
	for _, cmd := range c.calls {
		if strings.Contains(cmd, "docker rm") || strings.Contains(cmd, "docker run") || strings.Contains(cmd, "docker load") {
			t.Fatalf("modified existing unmanaged service: %s", cmd)
		}
	}
	c = &machineTestClient{t: t, managed: true}
	if err := (&devpodWorkspace{client: c}).ensureVMTailnet(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, cmd := range c.calls {
		for _, mutation := range []string{"docker load", "docker run", "docker rm", "tailscale up"} {
			if strings.Contains(cmd, mutation) {
				t.Fatalf("warm run changed service: %s", cmd)
			}
		}
	}
	c = &machineTestClient{t: t, fresh: true, fail: "docker load"}
	if err := (&devpodWorkspace{client: c}).ensureVMTailnet(context.Background()); err == nil {
		t.Fatal("ignored image load failure")
	}
	if strings.Contains(strings.Join(c.calls, "\n"), "docker run") {
		t.Fatal("continued after image failure")
	}
}

func TestMachineCommandRequiresAcknowledgment(t *testing.T) {
	c := &recordingClient{}
	if _, err := (&devpodWorkspace{client: c}).machineCommand(context.Background(), "true", nil); err == nil {
		t.Fatal("accepted empty transport")
	}
	c.output = "DEVPOD_MACHINE_COMMAND_OK\n"
	c.err = errors.New("transport failed")
	if _, err := (&devpodWorkspace{client: c}).machineCommand(context.Background(), "true", nil); err == nil {
		t.Fatal("ignored transport failure")
	}
}
