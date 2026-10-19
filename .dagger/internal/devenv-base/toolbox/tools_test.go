package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

const testCodespace = "bug-free-space-broccoli-jgp9vp7q75r2q96j"

// fakeCodespaces serves one codespace, in the given state, as GitHub's REST
// API would, and logs the requests. start and stop change its state.
func fakeCodespaces(t *testing.T, state string) (*codespaces, *[]string) {
	t.Helper()
	var got []string
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer gh-token" {
			t.Errorf("GitHub request without the token: %s %s", r.Method, r.URL.Path)
		}
		got = append(got, r.Method+" "+r.URL.Path)
		switch r.Method + " " + strings.TrimPrefix(r.URL.Path, "/user/codespaces/"+testCodespace) {
		case "POST /start":
			state = "Starting"
		case "POST /stop":
			state = "ShuttingDown"
		case "GET ":
		default:
			http.NotFound(w, r)
			return
		}
		fmt.Fprintf(w, `{"name": %q, "display_name": "bug-free space broccoli", "state": %q,
			"devcontainer_path": ".devcontainer/internal/devcontainer.json",
			"repository": {"full_name": "null-hype/agent-plugins"}, "git_status": {"ref": "main"}}`, testCodespace, state)
	}))
	t.Cleanup(gh.Close)
	return &codespaces{client: gh.Client(), url: gh.URL + "/user/codespaces", token: "gh-token"}, &got
}

func TestCodespaceTools(t *testing.T) {
	const cs = "bug-free space broccoli (null-hype/agent-plugins, branch main)"
	for _, c := range []struct {
		tool, state, want string
		posted            bool
	}{
		{"codespace_status", "Available", cs + " is running (Available).", false},
		{"codespace_status", "Shutdown", cs + " is stopped (Shutdown).", false},
		{"codespace_start", "Shutdown", "Asked GitHub to start " + cs + "; it is starting. codespace_status shows when it is running, usually after a minute or two.", true},
		{"codespace_start", "Available", cs + " is already running (Available). Nothing to do.", false},
		{"codespace_stop", "Available", "Asked GitHub to stop " + cs + "; it is stopping (ShuttingDown). Its files are kept; codespace_start starts it again.", true},
		{"codespace_stop", "Shutdown", cs + " is already stopped (Shutdown). Nothing to do.", false},
	} {
		tb, _, _ := newTestToolbox("RUNNING")
		var got *[]string
		tb.codespaces, got = fakeCodespaces(t, c.state)
		res := callTool(t, tb, c.tool, map[string]any{"name": testCodespace})
		if res.IsError || resultText(res) != c.want {
			t.Errorf("%s on %s = %q", c.tool, c.state, resultText(res))
		}
		if posted := strings.HasPrefix((*got)[len(*got)-1], "POST "); posted != c.posted {
			t.Errorf("%s on %s: GitHub requests %q", c.tool, c.state, *got)
		}
	}
}

// fakeGH writes a gh that logs its arguments, and whether GH_TOKEN was set,
// to the returned file.
func fakeGH(t *testing.T) (string, string) {
	t.Helper()
	dir := t.TempDir()
	log := filepath.Join(dir, "gh.calls")
	script := "#!/bin/sh\necho \"$* token=${GH_TOKEN:+set}\" >> " + log + "\n"
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "gh"), log
}

func TestCodespaceRebuildRunsGH(t *testing.T) {
	tb, _, _ := newTestToolbox("RUNNING")
	c, _ := fakeCodespaces(t, "Available")
	var log string
	c.gh, log = fakeGH(t)
	tb.codespaces = c
	res := callTool(t, tb, "codespace_rebuild", map[string]any{"name": testCodespace})
	want := "Rebuilding bug-free space broccoli (null-hype/agent-plugins, branch main) from .devcontainer/internal/devcontainer.json. Only /workspaces is kept; codespace_status shows when it is running again, usually after a few minutes."
	if res.IsError || resultText(res) != want {
		t.Fatalf("codespace_rebuild = %q", resultText(res))
	}
	calls, _ := os.ReadFile(log)
	if got := string(calls); got != "codespace rebuild --codespace "+testCodespace+" token=set\n" {
		t.Fatalf("gh calls %q", got)
	}
}

func TestCodespaceRebuildNeedsARunningCodespace(t *testing.T) {
	tb, _, _ := newTestToolbox("RUNNING")
	c, _ := fakeCodespaces(t, "Shutdown")
	var log string
	c.gh, log = fakeGH(t)
	tb.codespaces = c
	res := callTool(t, tb, "codespace_rebuild", map[string]any{"name": testCodespace})
	if !res.IsError || !strings.Contains(resultText(res), "Start it with codespace_start") {
		t.Fatalf("codespace_rebuild on a stopped codespace = %q", resultText(res))
	}
	if _, err := os.Stat(log); err == nil {
		t.Fatal("gh ran for a stopped codespace")
	}
}

func TestCodespaceToolsReject(t *testing.T) {
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("GitHub was called: %s", r.URL.Path)
	}))
	defer gh.Close()
	tb, _, _ := newTestToolbox("RUNNING")
	tb.codespaces = &codespaces{client: gh.Client(), url: gh.URL + "/user/codespaces", token: "gh-token"}
	for _, name := range []string{"", "../repos", "Bug-Free", "a/stop"} {
		if res := callTool(t, tb, "codespace_stop", map[string]any{"name": name}); !res.IsError {
			t.Errorf("codespace_stop %q was accepted", name)
		}
	}
}

func TestCodespaceErrorsSurface(t *testing.T) {
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message": "Resource not accessible by personal access token"}`, http.StatusForbidden)
	}))
	defer gh.Close()
	tb, _, _ := newTestToolbox("RUNNING")
	tb.codespaces = &codespaces{client: gh.Client(), url: gh.URL + "/user/codespaces", token: "gh-token"}
	res := callTool(t, tb, "codespace_start", map[string]any{"name": "some-codespace"})
	if !res.IsError || !strings.Contains(resultText(res), "403") {
		t.Fatalf("codespace_start on a 403 = %q", resultText(res))
	}
}
