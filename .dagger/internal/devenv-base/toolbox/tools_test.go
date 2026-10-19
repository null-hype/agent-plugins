package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/crypto/ssh"
)

type fakeGCE struct {
	status        string
	started, stop bool
}

func (f *fakeGCE) Instance(context.Context) (instance, error) {
	return instance{Status: f.status, IP: "203.0.113.7"}, nil
}
func (f *fakeGCE) Start(context.Context) error { f.started = true; return nil }
func (f *fakeGCE) Stop(context.Context) error  { f.stop = true; return nil }
func (f *fakeGCE) HostKeys(context.Context) ([]ssh.PublicKey, error) {
	return nil, nil
}

type hostCall struct {
	env  map[string]string
	args []string
}

// fakeHost answers host.sh actions from a canned workspace list.
type fakeHost struct {
	workspaces []workspace
	calls      []hostCall
}

func (f *fakeHost) Run(_ context.Context, env map[string]string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, hostCall{env, args})
	switch args[0] {
	case "list":
		return json.Marshal(f.workspaces)
	case "ping":
		return []byte(`{"ready": true, "tailnet": {"state": "Running", "name": "toolbox-host.tail.ts.net", "online": true}}`), nil
	case "status", "up", "stop", "delete", "review", "review-status":
		return []byte(`{}`), nil
	}
	return nil, fmt.Errorf("unexpected action %s", args[0])
}

func (f *fakeHost) actions() []string {
	var out []string
	for _, c := range f.calls {
		out = append(out, strings.Join(c.args, " "))
	}
	return out
}

func callTool(t *testing.T, tb *toolbox, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()
	ts := httptest.NewServer(newMux("s3cret", "http://example.test", tb))
	defer ts.Close()
	cs, err := connect(t, ts.URL, &http.Client{Transport: bearerTransport{"s3cret"}})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer cs.Close()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("call %s: %v", name, err)
	}
	return res
}

func resultText(res *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}

func newTestToolbox(status string, ws ...workspace) (*toolbox, *fakeGCE, *fakeHost) {
	g := &fakeGCE{status: status}
	h := &fakeHost{workspaces: ws}
	return &toolbox{gce: g, host: h, githubToken: "gh-token", passToken: "pass-token", tsAuthKey: "ts-key"}, g, h
}

func TestWorkspaceUpSendsOnlyTheGitHubToken(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	if res := callTool(t, tb, "workspace_up", map[string]any{"name": "cit-430"}); res.IsError {
		t.Fatalf("workspace_up: %s", resultText(res))
	}
	c := h.calls[0]
	if got := strings.Join(c.args, " "); got != "up cit-430 main 0" {
		t.Fatalf("args %q", got)
	}
	if len(c.env) != 1 || c.env["GITHUB_TOKEN"] != "gh-token" {
		t.Fatalf("env %v, want only GITHUB_TOKEN", c.env)
	}
}

func TestAgentStartBootstrapsWithThePassToken(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	if res := callTool(t, tb, "agent_start", map[string]any{"ref": "feature/x"}); res.IsError {
		t.Fatalf("agent_start: %s", resultText(res))
	}
	c := h.calls[0]
	if got := strings.Join(c.args, " "); got != "up linear-agent feature/x 1" {
		t.Fatalf("args %q", got)
	}
	if c.env["PROTON_PASS_PERSONAL_ACCESS_TOKEN"] != "pass-token" {
		t.Fatal("agent_start did not forward the Proton Pass token")
	}
}

func TestWorkspaceUpRejects(t *testing.T) {
	for _, args := range []map[string]any{
		{"name": "linear-agent"},
		{"name": "CIT-430"},
		{"name": "-rf"},
		{"name": "cit-430", "ref": "--reset"},
		{"name": "cit-430", "ref": "main; rm -rf /"},
	} {
		tb, _, h := newTestToolbox("RUNNING")
		if res := callTool(t, tb, "workspace_up", args); !res.IsError {
			t.Errorf("workspace_up %v was accepted", args)
		}
		if len(h.calls) != 0 {
			t.Errorf("workspace_up %v reached the host", args)
		}
	}
}

func TestHostStopStopsRunningWorkspacesFirst(t *testing.T) {
	tb, g, h := newTestToolbox("RUNNING",
		workspace{Name: "linear-agent", State: "Running"},
		workspace{Name: "cit-1", State: "Stopped"},
		workspace{Name: "cit-2", State: "Running"})
	if res := callTool(t, tb, "host_stop", nil); res.IsError {
		t.Fatalf("host_stop: %s", resultText(res))
	}
	if got := strings.Join(h.actions(), ", "); got != "list, stop linear-agent, stop cit-2" {
		t.Fatalf("host actions %q", got)
	}
	if !g.stop {
		t.Fatal("the VM was not stopped")
	}
}

func TestHostStopRefusesDuringAJob(t *testing.T) {
	tb, g, _ := newTestToolbox("RUNNING", workspace{Name: "cit-1", State: "Busy", JobRunning: true})
	if res := callTool(t, tb, "host_stop", nil); !res.IsError {
		t.Fatal("host_stop went ahead while a job was running")
	}
	if g.stop {
		t.Fatal("the VM was stopped")
	}
}

func TestHostStartWhenStopped(t *testing.T) {
	tb, g, _ := newTestToolbox("TERMINATED")
	if res := callTool(t, tb, "host_start", nil); res.IsError {
		t.Fatalf("host_start: %s", resultText(res))
	}
	if !g.started {
		t.Fatal("the VM was not started")
	}
}

func TestHostStatusOnlyPingsARunningHost(t *testing.T) {
	tb, _, h := newTestToolbox("TERMINATED")
	res := callTool(t, tb, "host_status", nil)
	if res.IsError || len(h.calls) != 0 {
		t.Fatalf("host_status on a stopped host: %s, host calls %v", resultText(res), h.actions())
	}
}

func TestHostStatusJoinsTheTailnet(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	res := callTool(t, tb, "host_status", nil)
	if res.IsError {
		t.Fatalf("host_status: %s", resultText(res))
	}
	if len(h.calls) != 1 || h.calls[0].env["TS_AUTHKEY"] != "ts-key" || len(h.calls[0].env) != 1 {
		t.Fatalf("ping env %v, want only TS_AUTHKEY", h.calls)
	}
	if got := resultText(res); !strings.Contains(got, `"ready":true`) || !strings.Contains(got, `"name":"toolbox-host.tail.ts.net"`) {
		t.Fatalf("host_status = %s", got)
	}
}

func TestCodexReviewPassesTheModelAndTokens(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	if res := callTool(t, tb, "codex_review", map[string]any{"pr": 221, "model": "gpt-5.5"}); res.IsError {
		t.Fatalf("codex_review: %s", resultText(res))
	}
	c := h.calls[0]
	if got := strings.Join(c.args, " "); got != "review 221 gpt-5.5" || c.env["GITHUB_TOKEN"] != "gh-token" || c.env["PROTON_PASS_PERSONAL_ACCESS_TOKEN"] != "pass-token" {
		t.Fatalf("host call %q env %v", got, c.env)
	}
}
