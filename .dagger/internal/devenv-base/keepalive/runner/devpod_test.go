package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/loft-sh/devpod/pkg/client"
	"github.com/loft-sh/devpod/pkg/provider"
)

// Embedding the interface makes unexpected calls fail rather than silently
// supplying successful defaults for operations the test does not exercise.
type recordingClient struct {
	client.WorkspaceClient
	statusOptions client.StatusOptions
	command       string
	output        string
	err           error
}

func (c *recordingClient) Status(_ context.Context, options client.StatusOptions) (client.Status, error) {
	c.statusOptions = options
	return client.StatusStopped, nil
}

func (c *recordingClient) AgentPath() string { return "/usr/local/bin/devpod" }
func (c *recordingClient) AgentInfo(provider.CLIOptions) (string, *provider.AgentWorkspaceInfo, error) {
	return "encoded-workspace", &provider.AgentWorkspaceInfo{}, nil
}
func (c *recordingClient) Command(_ context.Context, options client.CommandOptions) error {
	c.command = options.Command
	_, _ = io.WriteString(options.Stdout, c.output)
	return c.err
}

func TestStatusIncludesContainer(t *testing.T) {
	c := &recordingClient{}
	w := &devpodWorkspace{client: c}
	status, err := w.Status(context.Background())
	if err != nil || status != client.StatusStopped || !c.statusOptions.ContainerStatus {
		t.Fatalf("must query container status: status=%s options=%+v error=%v", status, c.statusOptions, err)
	}
}

func TestRefreshRequiresAcknowledgmentAndSuccessfulExit(t *testing.T) {
	for _, tc := range []struct {
		name      string
		output    string
		err       error
		wantError bool
	}{
		{"updated", "DEVPOD_KEEPALIVE_ACTIVITY_OK\n", nil, false},
		{"empty successful transport", "", nil, true},
		{"remote failure", "", errors.New("remote exit 1"), true},
		{"acknowledgment with transport error", "DEVPOD_KEEPALIVE_ACTIVITY_OK\n", errors.New("transport failed"), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &recordingClient{output: tc.output, err: tc.err}
			err := (&devpodWorkspace{client: c}).RefreshActivity(context.Background())
			if (err != nil) != tc.wantError {
				t.Fatalf("error=%v, want error=%v", err, tc.wantError)
			}
			if !strings.Contains(c.command, "agent workspace update-config --workspace-info encoded-workspace && printf") {
				t.Fatalf("acknowledgment must follow successful agent update: %s", c.command)
			}
		})
	}
}

func TestMissingMappingFails(t *testing.T) {
	t.Setenv("DEVPOD_HOME", t.TempDir())
	_, err := loadWorkspace(context.Background(), "missing-keepalive-workspace")
	if err == nil || !strings.Contains(err.Error(), "load existing workspace") {
		t.Fatalf("expected missing workspace error, got %v", err)
	}
}
