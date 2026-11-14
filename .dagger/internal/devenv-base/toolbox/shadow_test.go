package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceUpShadowSendsTheSessionAndOnlyThat(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	id := "0b8a1c2e-0000-4000-8000-123456789abc"
	if res := callTool(t, tb, "workspace_up", map[string]any{"name": "claude-shadow", "shadow": true, "session_id": id}); res.IsError {
		t.Fatalf("workspace_up: %s", resultText(res))
	}
	c := h.calls[0]
	if got := strings.Join(c.args, " "); got != "up claude-shadow main 0 1" {
		t.Fatalf("args %q", got)
	}
	if len(c.env) != 2 || c.env["GITHUB_TOKEN"] != "gh-token" || c.env["SHADOW_SESSION_ID"] != id {
		t.Fatalf("env %v", c.env)
	}
}

func TestWorkspaceUpShadowRejects(t *testing.T) {
	for _, args := range []map[string]any{
		{"name": "s", "shadow": true, "session_id": "x; rm -rf /"},
		{"name": "s", "shadow": true, "session_id": "0b8a1c2e-0000-4000-8000-123456789ab\n"},
		{"name": "s", "session_id": "0b8a1c2e-0000-4000-8000-123456789abc"},
		{"name": "linear-agent", "shadow": true},
	} {
		tb, _, h := newTestToolbox("RUNNING")
		if res := callTool(t, tb, "workspace_up", args); !res.IsError || len(h.calls) != 0 {
			t.Errorf("workspace_up %v was accepted or reached the host", args)
		}
	}
}

func TestShadowToolsReachTheHost(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	text := "it's \"quoted\"; $(id)\nline two"
	for tool, args := range map[string]map[string]any{
		"shadow_list":   {"name": "claude-shadow"},
		"shadow_read":   {"name": "claude-shadow", "lines": 30},
		"shadow_prompt": {"name": "claude-shadow", "text": text, "timeout_ms": 60000},
	} {
		if res := callTool(t, tb, tool, args); res.IsError {
			t.Fatalf("%s: %s", tool, resultText(res))
		}
	}
	got := strings.Join(h.actions(), "\n")
	for _, want := range []string{
		"shadow-list claude-shadow",
		"shadow-read claude-shadow w1:p1 30",
		"shadow-prompt claude-shadow w1:p1 60000 " + base64.StdEncoding.EncodeToString([]byte(text)),
	} {
		if !strings.Contains(got, want) {
			t.Errorf("no host call %q in\n%s", want, got)
		}
	}
	for _, c := range h.calls {
		if len(c.env) != 0 {
			t.Errorf("%v sent env %v", c.args, c.env)
		}
	}
}

func TestShadowToolsReject(t *testing.T) {
	long := strings.Repeat("x", maxPromptBytes+1)
	for tool, argsList := range map[string][]map[string]any{
		"shadow_list": {{"name": "CLAUDE"}, {"name": "-x"}, {"name": "a;b"}},
		"shadow_read": {
			{"name": "CLAUDE"},
			{"name": "s", "target": "--help"},
			{"name": "s", "target": "w1:p1; id"},
			{"name": "s", "lines": 501},
			{"name": "s", "lines": -1},
		},
		"shadow_prompt": {
			{"name": "CLAUDE", "text": "hi"},
			{"name": "s", "text": ""},
			{"name": "s", "text": long},
			{"name": "s", "text": "hi", "target": "-x"},
			{"name": "s", "text": "hi", "timeout_ms": 110001},
			{"name": "s", "text": "hi", "timeout_ms": 10},
		},
	} {
		for _, args := range argsList {
			tb, _, h := newTestToolbox("RUNNING")
			if res := callTool(t, tb, tool, args); !res.IsError || len(h.calls) != 0 {
				t.Errorf("%s %v was accepted or reached the host", tool, args)
			}
		}
	}
}

// fakeContainer sets up a home with fake devpod, herdr and claude. The fake
// devpod runs the --command it is given in bash, as the container would; the
// container's home is the host's here.
func fakeContainer(t *testing.T) (home string, run func(env []string, args ...string) string) {
	t.Helper()
	for _, tool := range []string{"bash", "jq", "base64", "timeout"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	if out, err := exec.Command("base64", "-w0", "/dev/null").CombinedOutput(); err != nil {
		t.Skipf("base64 -w0 unsupported: %s", out)
	}
	home = t.TempDir()
	bin := filepath.Join(home, "bin")
	os.Mkdir(bin, 0o755)
	os.MkdirAll(filepath.Join(home, ".local"), 0o755)
	os.Symlink(bin, filepath.Join(home, ".local/bin"))
	write := func(name, body string) { os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/bash\n"+body), 0o755) }
	write("devpod", `echo "$*" >> "$HOME/devpod.calls"
case $1 in
status) echo '{"state":"'"${FAKE_STATE:-Running}"'"}' ;;
ssh) while [ "$1" != --command ]; do shift; done; eval "$2" ;;
esac`)
	write("herdr", `echo "herdr $*" >> "$HOME/herdr.calls"
case "$*" in
"session list --json") echo '{"sessions":[{"name":"claude-shadow","running":true}]}' ;;
*"agent list") echo '{"result":{"agents":[{"name":"a"}]}}' ;;
*"pane list") echo '{"result":{"panes":[{"pane_id":"w1:p1","agent":"claude"}]}}' ;;
*"pane read"*) echo "row one"; echo "row two" ;;
*"agent prompt"*) jq -n --arg p "$6" '{result:{prompt:$p}}' ;;
esac`)
	write("claude", `echo "${CLAUDE_CODE_OAUTH_TOKEN:-unset}" >> "$HOME/claude.token"; echo '{"loggedIn": false}'`)
	run = func(env []string, args ...string) string {
		t.Helper()
		cmd := exec.Command("bash", append([]string{"-s", "--"}, args...)...)
		cmd.Env = append([]string{"HOME=" + home, "PATH=" + bin + ":" + os.Getenv("PATH")}, env...)
		cmd.Stdin = strings.NewReader(hostScript)
		out, err := cmd.Output()
		if err != nil {
			var stderr []byte
			if ee, ok := err.(*exec.ExitError); ok {
				stderr = ee.Stderr
			}
			t.Fatalf("host.sh %v: %v %s", args, err, stderr)
		}
		return strings.TrimSpace(string(out))
	}
	return home, run
}

// TestHostShadowActions runs host.sh's shadow actions, and workspace_status's
// shadow object, against the fake container.
func TestHostShadowActions(t *testing.T) {
	home, run := fakeContainer(t)
	var v map[string]any
	if err := json.Unmarshal([]byte(run(nil, "shadow-list", "claude-shadow")), &v); err != nil || v["agents"] == nil || v["panes"] == nil {
		t.Fatalf("shadow-list: %v %v", v, err)
	}
	if got := run(nil, "shadow-read", "claude-shadow", "w1:p1", "30"); !strings.Contains(got, `"text": "row one\nrow two"`) {
		t.Fatalf("shadow-read = %s", got)
	}
	prompt := "it's \"quoted\"; $(id)\nline two"
	got := run(nil, "shadow-prompt", "claude-shadow", "w1:p1", "60000", base64.StdEncoding.EncodeToString([]byte(prompt)))
	var reply struct{ Result struct{ Prompt string } }
	if err := json.Unmarshal([]byte(got), &reply); err != nil || reply.Result.Prompt != prompt {
		t.Fatalf("shadow-prompt = %s (%v)", got, err)
	}
	calls, _ := os.ReadFile(filepath.Join(home, "herdr.calls"))
	for _, want := range []string{
		"--session claude-shadow agent list",
		"--session claude-shadow pane read w1:p1 --source recent-unwrapped --lines 30",
		"--wait --timeout 60000",
	} {
		if !strings.Contains(string(calls), want) {
			t.Errorf("herdr calls lack %q:\n%s", want, calls)
		}
	}

	// status: a workspace without the marker has no shadow object; one with it
	// reports the probe, and Claude's login is read without the OAuth token.
	if strings.Contains(run(nil, "status", "claude-shadow"), `"shadow"`) {
		t.Fatal("status of a non-shadow workspace has a shadow object")
	}
	jobs := filepath.Join(home, ".toolbox/jobs")
	os.MkdirAll(jobs, 0o755)
	os.WriteFile(filepath.Join(jobs, "claude-shadow.shadow"), nil, 0o644)
	os.MkdirAll(filepath.Join(home, ".shadow"), 0o755)
	os.WriteFile(filepath.Join(home, ".shadow/claude-shadow.json"), []byte(`{"state":"needs-login"}`), 0o644)
	var st struct {
		Shadow struct {
			Session  bool           `json:"herdr_session"`
			Pane     bool           `json:"claude_pane"`
			LoggedIn any            `json:"logged_in"`
			Start    map[string]any `json:"start"`
			Attach   string         `json:"attach"`
			Detail   string         `json:"detail"`
		}
	}
	out := run([]string{"CLAUDE_CODE_OAUTH_TOKEN=secret"}, "status", "claude-shadow")
	if err := json.Unmarshal([]byte(out), &st); err != nil {
		t.Fatalf("status: %v\n%s", err, out)
	}
	s := st.Shadow
	if !s.Session || !s.Pane || s.LoggedIn != false || s.Start["state"] != "needs-login" || !strings.Contains(s.Attach, "herdr --session claude-shadow") || s.Detail != "" {
		t.Fatalf("shadow = %+v\n%s", s, out)
	}
	if tok, _ := os.ReadFile(filepath.Join(home, "claude.token")); strings.TrimSpace(string(tok)) != "unset" {
		t.Fatalf("claude auth status saw the OAuth token: %s", tok)
	}

	// A stopped workspace is not started to be probed.
	os.Remove(filepath.Join(home, "devpod.calls"))
	b := run([]string{"FAKE_STATE=Stopped"}, "status", "claude-shadow")
	if !strings.Contains(b, "the workspace is not running") {
		t.Fatalf("status of a stopped shadow: %s", b)
	}
	if c, _ := os.ReadFile(filepath.Join(home, "devpod.calls")); strings.Contains(string(c), "ssh") {
		t.Fatalf("a stopped workspace was ssh'd into:\n%s", c)
	}
}

// TestShadowConfigIsTheDefaultPlusTheHomeVolume checks that
// .devcontainer/shadow/devcontainer.json has not drifted from the default
// config it copies. Skipped where the repository is not around the toolbox
// (the toolbox's own image build).
func TestShadowConfigIsTheDefaultPlusTheHomeVolume(t *testing.T) {
	load := func(path string) map[string]any {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Skipf("%v", err)
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		return m
	}
	root := "../../../../.devcontainer"
	base, shadow := load(root+"/devcontainer.json"), load(root+"/shadow/devcontainer.json")
	mounts, _ := shadow["mounts"].([]any)
	if len(mounts) != 1 {
		t.Fatalf("mounts = %v", shadow["mounts"])
	}
	m, _ := mounts[0].(map[string]any)
	if m["type"] != "volume" || m["source"] != "${localEnv:SHADOW_WORKSPACE}-home" || m["target"] != "/home/vscode" {
		t.Fatalf("home mount = %v", m)
	}
	delete(shadow, "mounts")
	if _, has := base["mounts"]; has {
		t.Fatal("the default config has mounts of its own; merge them into the shadow's")
	}
	if a, b := mustJSON(base), mustJSON(shadow); a != b {
		t.Fatalf("shadow config differs from the default beyond mounts:\n%s\n%s", a, b)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

// fakeShadowHome sets up a home for start-shadow.sh with fake herdr and claude.
// The fake herdr keeps a session, one pane and what runs in it. When claude is
// "run" into the pane it sets the agent label, unless FAKE_NO_LABEL is set, and
// starts a process whose command line holds --remote-control <ws>, as Claude's
// would; FAKE_FOREGROUND is the pane's foreground before that (default bash).
func fakeShadowHome(t *testing.T) (home, state string, run func(env ...string) (string, error)) {
	t.Helper()
	script, err := os.ReadFile("../.devcontainer/start-shadow.sh")
	if err != nil {
		t.Skipf("%v", err)
	}
	for _, tool := range []string{"bash", "jq", "sha256sum", "setsid", "flock", "pgrep"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	if _, err := os.Stat("/proc/mounts"); err != nil {
		t.Skip("no /proc/mounts")
	}
	home = t.TempDir()
	ws := filepath.Join(home, "workspaces/shadow-ws")
	dir := filepath.Join(ws, ".dagger/internal/devenv-base/.devcontainer")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "start-shadow.sh"), script, 0o755)
	bin := filepath.Join(home, ".local/bin")
	os.MkdirAll(bin, 0o755)
	state = filepath.Join(home, "fake-herdr")
	os.MkdirAll(state, 0o755)
	write := func(name, body string) { os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/bash\n"+body), 0o755) }
	write("herdr", `S=`+state+`
echo "herdr $*" >> $S/calls
case "$*" in
--version) echo "herdr 0.9.5" ;;
"session list --json") if [ -f $S/session ]; then echo '{"sessions":[{"name":"shadow-ws","running":true}]}'; else echo '{"sessions":[]}'; fi ;;
"--session shadow-ws server") touch $S/session; echo "env: ${CLAUDE_CODE_OAUTH_TOKEN:-unset}" > $S/server.env; sleep 30 ;;
"--session shadow-ws pane list") if [ -f $S/pane ]; then jq -n --arg a "$(cat $S/agent 2>/dev/null)" '{result:{panes:[{pane_id:"w1:p1",agent:(if $a=="" then null else $a end)}]}}'; else echo '{"result":{"panes":[]}}'; fi ;;
"--session shadow-ws pane process-info --pane w1:p1") jq -n --arg n "$(cat $S/fg 2>/dev/null || echo ${FAKE_FOREGROUND:-bash})" '{result:{process_info:{foreground_processes:[{name:$n}]}}}' ;;
"--session shadow-ws workspace create"*) touch $S/pane; echo '{"result":{"root_pane":{"pane_id":"w1:p1"}}}' ;;
"--session shadow-ws pane run w1:p1 "*)
  echo "$6" > $S/run; echo claude > $S/fg
  [ -n "${FAKE_NO_LABEL:-}" ] || echo claude > $S/agent
  setsid nohup bash -c 'sleep 30; :' _ --remote-control shadow-ws >/dev/null 2>&1 </dev/null 9>&- &
  ;;
esac`)
	write("claude", `echo "{\"loggedIn\": ${FAKE_LOGGED_IN:-true}}"`)
	run = func(env ...string) (string, error) {
		cmd := exec.Command("bash", filepath.Join(dir, "start-shadow.sh"))
		cmd.Env = append([]string{"HOME=" + home, "PATH=" + bin + ":" + os.Getenv("PATH"), "CLAUDE_CODE_OAUTH_TOKEN=secret"}, env...)
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	t.Cleanup(func() { exec.Command("pkill", "-f", "shadow-ws").Run(); exec.Command("pkill", "-f", "sleep 30").Run() })
	return home, state, run
}

// TestStartShadow runs start-shadow.sh twice: the second run must change nothing.
func TestStartShadow(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	id := "0b8a1c2e-0000-4000-8000-123456789abc"
	if out, err := run("SHADOW_SESSION_ID=" + id); err != nil {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	ran, _ := os.ReadFile(filepath.Join(state, "run"))
	if want := "env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude --resume " + id + " --remote-control shadow-ws"; strings.TrimSpace(string(ran)) != want {
		t.Fatalf("claude ran as %q, want %q", ran, want)
	}
	if env, _ := os.ReadFile(filepath.Join(state, "server.env")); !strings.Contains(string(env), "unset") {
		t.Fatalf("herdr server saw the OAuth token: %s", env)
	}
	before, _ := os.ReadFile(filepath.Join(state, "calls"))
	// Again, without the id: the remembered one is not needed, and nothing starts.
	if out, err := run(); err != nil {
		t.Fatalf("second run: %v\n%s", err, out)
	}
	after, _ := os.ReadFile(filepath.Join(state, "calls"))
	extra := strings.TrimPrefix(string(after), string(before))
	if strings.Contains(extra, "server") || strings.Contains(extra, "pane run") || strings.Contains(extra, "workspace create") {
		t.Fatalf("the second run started something:\n%s", extra)
	}
	var st struct{ State string }
	b, _ := os.ReadFile(filepath.Join(home, ".shadow/shadow-ws.json"))
	if json.Unmarshal(b, &st); st.State != "running" {
		t.Fatalf("state = %s", b)
	}
	if remembered, _ := os.ReadFile(filepath.Join(home, ".shadow/shadow-ws.session-id")); strings.TrimSpace(string(remembered)) != id {
		t.Fatalf("session id not remembered: %q", remembered)
	}
	// Not logged in: left up, recorded.
	if out, err := run("FAKE_LOGGED_IN=false"); err != nil {
		t.Fatalf("not logged in: %v\n%s", err, out)
	}
	b, _ = os.ReadFile(filepath.Join(home, ".shadow/shadow-ws.json"))
	if json.Unmarshal(b, &st); st.State != "needs-login" {
		t.Fatalf("state = %s", b)
	}
	// A bad session id fails and says so.
	if out, err := run("SHADOW_SESSION_ID=nope"); err == nil {
		t.Fatalf("a bad session id was accepted:\n%s", out)
	}
}

// Herdr may not label Claude (the label was never confirmed): a Claude process
// for the workspace must still stop a second run from typing the launch command
// into the live Claude as a prompt.
func TestStartShadowWithoutAgentLabelDoesNotRelaunch(t *testing.T) {
	_, state, run := fakeShadowHome(t)
	// The first run starts Claude; its process counts as running without a label.
	if out, err := run("FAKE_NO_LABEL=1"); err != nil {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	before, _ := os.ReadFile(filepath.Join(state, "calls"))
	if !strings.Contains(string(before), "pane run") {
		t.Fatalf("the first run never started claude:\n%s", before)
	}
	// The pane's foreground is now claude and Herdr gives it no label.
	if out, err := run("FAKE_NO_LABEL=1"); err != nil {
		t.Fatalf("second run: %v\n%s", err, out)
	}
	after, _ := os.ReadFile(filepath.Join(state, "calls"))
	if extra := strings.TrimPrefix(string(after), string(before)); strings.Contains(extra, "pane run") {
		t.Fatalf("the second run typed into the live claude:\n%s", extra)
	}
}

// With no label and no Claude process, a pane whose foreground is not a shell
// is not typed into either: the run fails and says why.
func TestStartShadowRefusesANonShellPane(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	os.WriteFile(filepath.Join(state, "pane"), nil, 0o644)
	os.WriteFile(filepath.Join(state, "session"), nil, 0o644)
	out, err := run("FAKE_FOREGROUND=node")
	if err == nil || !strings.Contains(out, "not an idle shell") {
		t.Fatalf("run = %v\n%s", err, out)
	}
	if calls, _ := os.ReadFile(filepath.Join(state, "calls")); strings.Contains(string(calls), "pane run") {
		t.Fatalf("typed into a non-shell pane:\n%s", calls)
	}
	var st struct{ State, Detail string }
	b, _ := os.ReadFile(filepath.Join(home, ".shadow/shadow-ws.json"))
	if json.Unmarshal(b, &st); st.State != "failed" || st.Detail == "" {
		t.Fatalf("state = %s", b)
	}
}
