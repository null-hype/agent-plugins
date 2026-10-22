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
	// jobs and agent are the work activity reports besides workspace jobs;
	// agentStatus is the status action's answer for the agent workspace.
	jobs        []string
	agent       bool
	agentStatus string
	// agentLive is the agent-live action's answer: the webhook check, now.
	agentLive bool
}

func (f *fakeHost) Run(_ context.Context, env map[string]string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, hostCall{env, args})
	switch args[0] {
	case "list":
		return json.Marshal(f.workspaces)
	case "activity":
		jobs := append([]string{}, f.jobs...)
		for _, w := range f.workspaces {
			if w.JobRunning {
				jobs = append(jobs, w.Name)
			}
		}
		return json.Marshal(activityOut{Jobs: jobs, AgentRunning: f.agent})
	case "status":
		if args[1] == agentWorkspace && f.agentStatus != "" {
			return []byte(f.agentStatus), nil
		}
		return []byte(`{}`), nil
	case "agent-live":
		return json.Marshal(map[string]any{"live": f.agentLive, "detail": "LIVE_WEBHOOK_CHECK: FAIL"})
	case "ping":
		return []byte(`{"ready": true, "tailnet": {"state": "Running", "name": "toolbox-host.tail.ts.net", "online": true},
			"lifecycle": {"idle_limit": 900, "idle_for": 30, "lease_until": 1761000000}}`), nil
	case "up", "stop", "delete", "review", "review-status", "ship", "ship-status":
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
	if got := strings.Join(h.actions(), ", "); got != "activity, list, stop linear-agent, stop cit-2" {
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

// Ship and review jobs are not named after a workspace, and the agent's own
// work is no job at all; host_stop used to miss all three.
func TestHostStopRefusesDuringShipReviewOrAgentWork(t *testing.T) {
	for name, set := range map[string]func(*fakeHost){
		"ship":   func(h *fakeHost) { h.jobs = []string{"ship"} },
		"review": func(h *fakeHost) { h.jobs = []string{"review-240"} },
		"agent":  func(h *fakeHost) { h.agent = true },
	} {
		tb, g, h := newTestToolbox("RUNNING", workspace{Name: "linear-agent", State: "Running"})
		set(h)
		if res := callTool(t, tb, "host_stop", nil); !res.IsError {
			t.Fatalf("%s: host_stop went ahead", name)
		}
		if g.stop || len(h.actions()) != 1 {
			t.Fatalf("%s: host actions %v, VM stopped %v", name, h.actions(), g.stop)
		}
	}
}

func TestHostWakeStepsToReady(t *testing.T) {
	wake := func(tb *toolbox) wakeOut {
		t.Helper()
		res := callTool(t, tb, "host_wake", nil)
		if res.IsError {
			t.Fatalf("host_wake: %s", resultText(res))
		}
		var out wakeOut
		if err := json.Unmarshal([]byte(resultText(res)), &out); err != nil {
			t.Fatalf("host_wake output %s: %v", resultText(res), err)
		}
		return out
	}

	tb, g, h := newTestToolbox("TERMINATED")
	if out := wake(tb); out.Ready || out.Phase != "vm-starting" || !g.started || len(h.calls) != 0 {
		t.Fatalf("stopped VM: %+v, started %v, host calls %v", out, g.started, h.actions())
	}

	// No agent start since this boot: host_wake starts it with the pass token.
	tb, _, h = newTestToolbox("RUNNING")
	h.agentStatus = `{"state": "Stopped", "job_running": false, "job_exit": null}`
	if out := wake(tb); out.Ready || out.Phase != "agent-starting" {
		t.Fatalf("agent not started: %+v", out)
	}
	last := h.calls[len(h.calls)-1]
	if strings.Join(last.args, " ") != "up linear-agent main 1" || last.env["PROTON_PASS_PERSONAL_ACCESS_TOKEN"] != "pass-token" {
		t.Fatalf("agent start call %v", last)
	}

	for status, want := range map[string]string{
		`{"state": "Running", "job_running": true, "job_exit": null}`: "agent-starting",
		`{"state": "Running", "job_running": false, "job_exit": 0}`:   "ready",
		`{"state": "Running", "job_running": false, "job_exit": 1}`:   "agent-failed",
	} {
		tb, _, h = newTestToolbox("RUNNING")
		h.agentStatus = status
		h.agentLive = true
		out := wake(tb)
		if out.Phase != want || out.Ready != (want == "ready") {
			t.Fatalf("agent status %s: %+v, want %s", status, out, want)
		}
		for _, c := range h.calls {
			if c.args[0] == "up" {
				t.Fatalf("agent status %s: host_wake started the agent again", status)
			}
		}
	}
}

// An old start result is not readiness: the webhook is checked on every
// call, and an agent whose webhook stopped answering is restarted (CIT-467).
func TestHostWakeChecksTheWebhookNow(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	h.agentStatus = `{"state": "Running", "job_running": false, "job_exit": 0}`
	res := callTool(t, tb, "host_wake", nil)
	var out wakeOut
	if err := json.Unmarshal([]byte(resultText(res)), &out); err != nil || out.Ready || out.Phase != "agent-restarting" {
		t.Fatalf("dead webhook: %s", resultText(res))
	}
	acts := h.actions()
	if acts[len(acts)-2] != "agent-live linear-agent" || acts[len(acts)-1] != "up linear-agent main 1" {
		t.Fatalf("host calls %v, want the live check then a restart", acts)
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
	// The lifecycle is an object; an output schema that wants anything else
	// fails the whole call (CIT-487).
	if got := resultText(res); !strings.Contains(got, `"ready":true`) || !strings.Contains(got, `"name":"toolbox-host.tail.ts.net"`) ||
		!strings.Contains(got, `"idle_limit":900`) {
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

func TestAgentShipSendsNoSecrets(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	args := map[string]any{"env": "trusty-burro", "branch": "cit-432-fix"}
	if res := callTool(t, tb, "agent_ship", args); res.IsError {
		t.Fatalf("agent_ship: %s", resultText(res))
	}
	c := h.calls[0]
	if got := strings.Join(c.args, " "); got != "ship linear-agent trusty-burro cit-432-fix" {
		t.Fatalf("args %q", got)
	}
	if len(c.env) != 0 {
		t.Fatalf("env %v, want none: the host resolves the push token through its own pass session", c.env)
	}
}

func TestAgentShipStatus(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	if res := callTool(t, tb, "agent_ship_status", map[string]any{}); res.IsError {
		t.Fatalf("agent_ship_status: %s", resultText(res))
	}
	if got := h.actions(); len(got) != 1 || got[0] != "ship-status" || len(h.calls[0].env) != 0 {
		t.Fatalf("host calls %v env %v", got, h.calls[0].env)
	}
}

func TestAgentShipRejects(t *testing.T) {
	ok := map[string]any{"env": "trusty-burro", "branch": "cit-432-fix"}
	for k, v := range map[string]any{
		"env":    "trusty-burro; rm -rf /",
		"branch": "main",
	} {
		args := map[string]any{}
		for kk, vv := range ok {
			args[kk] = vv
		}
		args[k] = v
		tb, _, h := newTestToolbox("RUNNING")
		if res := callTool(t, tb, "agent_ship", args); !res.IsError {
			t.Errorf("agent_ship with %s=%q was accepted", k, v)
		}
		if len(h.calls) != 0 {
			t.Errorf("agent_ship with %s=%q reached the host", k, v)
		}
	}
	for _, branch := range []string{"--force", "a b", "x'y", "a\nb"} {
		tb, _, h := newTestToolbox("RUNNING")
		if res := callTool(t, tb, "agent_ship", map[string]any{"env": "trusty-burro", "branch": branch}); !res.IsError || len(h.calls) != 0 {
			t.Errorf("agent_ship with branch %q was accepted", branch)
		}
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
