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

const testThread = "https://delta.dev/join/thread_01HX-abc_DEF"

func TestWorkspaceUpShadowSendsTheSessionAndOnlyThat(t *testing.T) {
	tb, _, h := newTestToolbox("RUNNING")
	id := "0b8a1c2e-0000-4000-8000-123456789abc"
	if res := callTool(t, tb, "workspace_up", map[string]any{"name": "claude-shadow", "shadow": true, "session_id": id, "delta_thread": testThread}); res.IsError {
		t.Fatalf("workspace_up: %s", resultText(res))
	}
	c := h.calls[0]
	if got := strings.Join(c.args, " "); got != "up claude-shadow main 0 1" {
		t.Fatalf("args %q", got)
	}
	if len(c.env) != 3 || c.env["GITHUB_TOKEN"] != "gh-token" || c.env["SHADOW_SESSION_ID"] != id || c.env["SHADOW_DELTA_THREAD"] != testThread {
		t.Fatalf("env %v", c.env)
	}
}

func TestWorkspaceUpShadowRejects(t *testing.T) {
	for _, args := range []map[string]any{
		{"name": "s", "shadow": true, "session_id": "x; rm -rf /"},
		{"name": "s", "shadow": true, "session_id": "0b8a1c2e-0000-4000-8000-123456789ab\n"},
		{"name": "s", "session_id": "0b8a1c2e-0000-4000-8000-123456789abc"},
		{"name": "linear-agent", "shadow": true},
		{"name": "s", "delta_thread": testThread},
		{"name": "s", "shadow": true, "delta_thread": "https://evil.example/join/thread_x"},
		{"name": "s", "shadow": true, "delta_thread": "https://delta.dev/join/thread_x; id"},
		{"name": "s", "shadow": true, "delta_thread": "https://delta.dev/join/thread_x/../y"},
		{"name": "s", "shadow": true, "delta_thread": "http://delta.dev/join/thread_x"},
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
	write("claude", `echo "${CLAUDE_CODE_OAUTH_TOKEN:-unset}" >> "$HOME/claude.token"; echo '{"loggedIn": '${FAKE_LOGGED_IN:-false}'}'`)
	write("delta", `exit ${FAKE_DELTA_STATUS:-0}`)
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
			State    string         `json:"state"`
			Delta    any            `json:"delta_signed_in"`
			Detail   string         `json:"detail"`
		}
	}
	out := run([]string{"CLAUDE_CODE_OAUTH_TOKEN=secret"}, "status", "claude-shadow")
	if err := json.Unmarshal([]byte(out), &st); err != nil {
		t.Fatalf("status: %v\n%s", err, out)
	}
	s := st.Shadow
	if !s.Session || !s.Pane || s.LoggedIn != false || s.State != "needs-login" || s.Start["state"] != "needs-login" || s.Detail != "" ||
		!strings.Contains(s.Attach, `gcloud compute ssh toolbox-host --zone us-central1-a --project caldav-444421 -- -t `) ||
		!strings.Contains(s.Attach, `sudo -u toolbox -H devpod ssh claude-shadow --command "/root/.local/bin/herdr --session claude-shadow"`) {
		t.Fatalf("shadow = %+v\n%s", s, out)
	}
	if tok, _ := os.ReadFile(filepath.Join(home, "claude.token")); strings.TrimSpace(string(tok)) != "unset" {
		t.Fatalf("claude auth status saw the OAuth token: %s", tok)
	}

	// start-shadow.sh's record goes stale once someone logs in: the live state
	// follows the probe, whatever start still says.
	out = run([]string{"FAKE_LOGGED_IN=true"}, "status", "claude-shadow")
	st.Shadow = struct {
		Session  bool           `json:"herdr_session"`
		Pane     bool           `json:"claude_pane"`
		LoggedIn any            `json:"logged_in"`
		Start    map[string]any `json:"start"`
		Attach   string         `json:"attach"`
		State    string         `json:"state"`
		Delta    any            `json:"delta_signed_in"`
		Detail   string         `json:"detail"`
	}{}
	if err := json.Unmarshal([]byte(out), &st); err != nil || st.Shadow.State != "running" || st.Shadow.Start["state"] != "needs-login" || st.Shadow.Delta != true {
		t.Fatalf("after login: %v %s", err, out)
	}
	out = run([]string{"FAKE_LOGGED_IN=true", "FAKE_DELTA_STATUS=1"}, "status", "claude-shadow")
	if !strings.Contains(out, `"state": "needs-delta-login"`) {
		t.Fatalf("delta signed out: %s", out)
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
	if m["type"] != "volume" || m["source"] != "${localEnv:SHADOW_WORKSPACE}-home" || m["target"] != "/root" {
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

const testUUID = "0b8a1c2e-0000-4000-8000-123456789abc"

// fakeShadowHome sets up a home for start-shadow.sh with fake herdr, claude and
// delta. The fake herdr keeps a session, one pane, and what runs in it, in
// files under state: fg (the foreground program), cmdline, agent (the label),
// session-uuid. Running claude in the pane sets them and starts a process whose
// command line holds the claude command line, as Claude's would. FAKE_NO_LABEL
// leaves the label off; FAKE_STUCK makes /exit and Ctrl+C do nothing.
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
"--session shadow-ws pane list") if [ -f $S/pane ]; then jq -n --arg a "$(cat $S/agent 2>/dev/null)" --arg u "$(cat $S/session-uuid 2>/dev/null)" \
  '{result:{panes:[{pane_id:"w1:p1",agent:(if $a=="" then null else $a end)} + (if $u=="" then {} else {agent_session:{value:$u}} end)]}}'; else echo '{"result":{"panes":[]}}'; fi ;;
"--session shadow-ws pane process-info --pane w1:p1") jq -n --arg n "$(cat $S/fg 2>/dev/null || echo bash)" --arg c "$(cat $S/cmdline 2>/dev/null)" '{result:{process_info:{foreground_processes:[{name:$n,argv0:$n,cmdline:(if $c=="" then $n else $c end)}]}}}' ;;
"--session shadow-ws workspace create"*) touch $S/pane; echo '{"result":{"root_pane":{"pane_id":"w1:p1"}}}' ;;
"--session shadow-ws pane send-text w1:p1 /exit") touch $S/exit_typed ;;
"--session shadow-ws pane send-keys w1:p1 enter"|"--session shadow-ws pane send-keys w1:p1 ctrl+c ctrl+c")
  if [ -z "${FAKE_STUCK:-}" ] && { [ -f $S/exit_typed ] || [ "$6" = ctrl+c ]; }; then echo bash > $S/fg; rm -f $S/agent $S/cmdline $S/exit_typed; pkill -f "remote-control-fake" || true; fi ;;
"--session shadow-ws agent prompt w1:p1 "*) echo "$6" >> $S/prompts ;;
"--session shadow-ws pane run w1:p1 "*)
  echo "$6" >> $S/runs; c=${6#env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY }
  echo claude > $S/fg; echo "$c" > $S/cmdline; echo `+testUUID+` > $S/session-uuid
  [ -n "${FAKE_NO_LABEL:-}" ] || echo claude > $S/agent
  setsid nohup bash -c 'sleep 30; :' remote-control-fake $c >/dev/null 2>&1 </dev/null 9>&- &
  ;;
esac`)
	write("claude", `S=`+state+`
echo "claude $*" >> $S/claude.calls
case "$1 $2" in
"auth status") echo "{\"loggedIn\": ${FAKE_LOGGED_IN:-true}}" ;;
"plugin list") if [ -f $S/plugin ]; then echo '[{"id":"delta@zed-industries"}]'; else echo '[]'; fi ;;
"plugin marketplace") ;;
"plugin install") touch $S/plugin ;;
esac`)
	write("delta", `exit ${FAKE_DELTA_STATUS:-0}`)
	run = func(env ...string) (string, error) {
		cmd := exec.Command("bash", filepath.Join(dir, "start-shadow.sh"))
		cmd.Env = append([]string{"HOME=" + home, "PATH=" + bin + ":" + os.Getenv("PATH"), "CLAUDE_CODE_OAUTH_TOKEN=secret", "SHADOW_STOP_WAIT=1"}, env...)
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	t.Cleanup(func() {
		exec.Command("pkill", "-f", "remote-control-fake").Run()
		exec.Command("pkill", "-f", "sleep 30").Run()
	})
	return home, state, run
}

func readFile(path string) string { b, _ := os.ReadFile(path); return string(b) }

func shadowState(t *testing.T, home string) (st struct {
	State, Detail, Delta string
	Joined               []string
}) {
	t.Helper()
	if err := json.Unmarshal([]byte(readFile(filepath.Join(home, ".shadow/shadow-ws.json"))), &st); err != nil {
		t.Fatalf("state file: %v", err)
	}
	return st
}

// TestStartShadow runs start-shadow.sh twice: the second run must change nothing.
func TestStartShadow(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	if out, err := run("SHADOW_SESSION_ID=" + testUUID); err != nil {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	runs := strings.TrimSpace(readFile(filepath.Join(state, "runs")))
	if want := "env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude --resume " + testUUID + " --remote-control shadow-ws"; runs != want {
		t.Fatalf("claude ran as %q, want %q", runs, want)
	}
	if env := readFile(filepath.Join(state, "server.env")); !strings.Contains(env, "unset") {
		t.Fatalf("herdr server saw the OAuth token: %s", env)
	}
	before := readFile(filepath.Join(state, "calls"))
	// Again, without the id: nothing starts.
	if out, err := run(); err != nil {
		t.Fatalf("second run: %v\n%s", err, out)
	}
	extra := strings.TrimPrefix(readFile(filepath.Join(state, "calls")), before)
	for _, bad := range []string{"server", "pane run", "workspace create", "send-text", "agent prompt"} {
		if strings.Contains(extra, bad) {
			t.Fatalf("the second run did %q:\n%s", bad, extra)
		}
	}
	if st := shadowState(t, home); st.State != "running" || st.Delta != "signed-in" {
		t.Fatalf("state = %+v", st)
	}
	// The session is remembered, taken from Herdr.
	if got := strings.TrimSpace(readFile(filepath.Join(home, ".shadow/shadow-ws.session-id"))); got != testUUID {
		t.Fatalf("session id not remembered: %q", got)
	}
	// The plugin was installed once, and the first-run settings written.
	if n := strings.Count(readFile(filepath.Join(state, "claude.calls")), "plugin install delta@zed-industries"); n != 1 {
		t.Fatalf("plugin installed %d times:\n%s", n, readFile(filepath.Join(state, "claude.calls")))
	}
	if got := readFile(filepath.Join(home, ".claude/settings.json")); !strings.Contains(got, `"tui": "default"`) || !strings.Contains(got, `"theme": "dark"`) {
		t.Fatalf("settings.json = %s", got)
	}
	// Not logged in: left up, recorded.
	if out, err := run("FAKE_LOGGED_IN=false"); err != nil {
		t.Fatalf("not logged in: %v\n%s", err, out)
	}
	if st := shadowState(t, home); st.State != "needs-login" {
		t.Fatalf("state = %+v", st)
	}
	// A bad session id or thread link fails and says so.
	for _, env := range []string{"SHADOW_SESSION_ID=nope", "SHADOW_DELTA_THREAD=https://evil.example/join/thread_x"} {
		if out, err := run(env); err == nil {
			t.Fatalf("%s was accepted:\n%s", env, out)
		}
	}
}

func TestStartShadowKeepsExistingFirstRunSettings(t *testing.T) {
	home, _, run := fakeShadowHome(t)
	os.MkdirAll(filepath.Join(home, ".claude"), 0o755)
	os.WriteFile(filepath.Join(home, ".claude/settings.json"), []byte(`{"theme":"light","model":"opus"}`), 0o644)
	if out, err := run(); err != nil {
		t.Fatalf("run: %v\n%s", err, out)
	}
	got := readFile(filepath.Join(home, ".claude/settings.json"))
	if !strings.Contains(got, `"theme": "light"`) || !strings.Contains(got, `"model": "opus"`) || !strings.Contains(got, `"tui": "default"`) {
		t.Fatalf("settings.json = %s", got)
	}
}

// Herdr may not label Claude (it does, but a login screen may not): a Claude
// process for the workspace must still stop a second run from typing the launch
// command into the live Claude as a prompt.
func TestStartShadowWithoutAgentLabelDoesNotRelaunch(t *testing.T) {
	_, state, run := fakeShadowHome(t)
	if out, err := run("FAKE_NO_LABEL=1"); err != nil {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	before := readFile(filepath.Join(state, "calls"))
	if !strings.Contains(before, "pane run") {
		t.Fatalf("the first run never started claude:\n%s", before)
	}
	if out, err := run("FAKE_NO_LABEL=1"); err != nil {
		t.Fatalf("second run: %v\n%s", err, out)
	}
	if extra := strings.TrimPrefix(readFile(filepath.Join(state, "calls")), before); strings.Contains(extra, "pane run") || strings.Contains(extra, "send-text") {
		t.Fatalf("the second run typed into the live claude:\n%s", extra)
	}
}

// After a server restart Herdr restores the pane and resumes Claude itself,
// without --remote-control. The script must stop it and start it properly,
// resuming the session Herdr reports.
func TestStartShadowRestartsAClaudeWithoutRemoteControl(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	for name, body := range map[string]string{"session": "", "pane": "", "agent": "claude\n", "fg": "claude\n",
		"cmdline": "claude --resume " + testUUID + "\n", "session-uuid": testUUID + "\n"} {
		os.WriteFile(filepath.Join(state, name), []byte(body), 0o644)
	}
	if out, err := run(); err != nil {
		t.Fatalf("run: %v\n%s", err, out)
	}
	calls := readFile(filepath.Join(state, "calls"))
	exit, launch := strings.Index(calls, "pane send-text w1:p1 /exit"), strings.Index(calls, "pane run w1:p1")
	if exit < 0 || launch < exit {
		t.Fatalf("claude was not stopped before it was started again:\n%s", calls)
	}
	want := "env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude --resume " + testUUID + " --remote-control shadow-ws"
	if got := strings.TrimSpace(readFile(filepath.Join(state, "runs"))); got != want {
		t.Fatalf("restarted as %q, want %q", got, want)
	}
	if st := shadowState(t, home); st.State != "running" {
		t.Fatalf("state = %+v", st)
	}
	// And the next run leaves it alone.
	before := readFile(filepath.Join(state, "calls"))
	if out, err := run(); err != nil {
		t.Fatalf("second run: %v\n%s", err, out)
	}
	if extra := strings.TrimPrefix(readFile(filepath.Join(state, "calls")), before); strings.Contains(extra, "send-text") || strings.Contains(extra, "pane run") {
		t.Fatalf("the second run touched claude:\n%s", extra)
	}
}

// A Claude that will not exit is not typed into further, and no launch
// command follows.
func TestStartShadowFailsWhenClaudeWillNotStop(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	for name, body := range map[string]string{"session": "", "pane": "", "agent": "claude\n", "fg": "claude\n", "cmdline": "claude --resume " + testUUID + "\n"} {
		os.WriteFile(filepath.Join(state, name), []byte(body), 0o644)
	}
	out, err := run("FAKE_STUCK=1")
	if err == nil || !strings.Contains(out, "could not stop") {
		t.Fatalf("run = %v\n%s", err, out)
	}
	if calls := readFile(filepath.Join(state, "calls")); strings.Contains(calls, "pane run") {
		t.Fatalf("typed a launch command into a live claude:\n%s", calls)
	}
	if st := shadowState(t, home); st.State != "failed" {
		t.Fatalf("state = %+v", st)
	}
}

// With no label and no Claude process, a pane whose foreground is not a shell
// is not typed into either: the run fails and says why.
func TestStartShadowRefusesANonShellPane(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	os.WriteFile(filepath.Join(state, "pane"), nil, 0o644)
	os.WriteFile(filepath.Join(state, "session"), nil, 0o644)
	os.WriteFile(filepath.Join(state, "fg"), []byte("node\n"), 0o644)
	out, err := run()
	if err == nil || !strings.Contains(out, "not an idle shell") {
		t.Fatalf("run = %v\n%s", err, out)
	}
	if calls := readFile(filepath.Join(state, "calls")); strings.Contains(calls, "pane run") {
		t.Fatalf("typed into a non-shell pane:\n%s", calls)
	}
	if st := shadowState(t, home); st.State != "failed" || st.Detail == "" {
		t.Fatalf("state = %+v", st)
	}
}

// Delta sign-in is never attempted: a shadow that is not signed in stays up
// and says what to run; it joins nothing.
func TestStartShadowNeedsDeltaLogin(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	if out, err := run("FAKE_DELTA_STATUS=1", "SHADOW_DELTA_THREAD="+testThread); err != nil {
		t.Fatalf("run: %v\n%s", err, out)
	}
	st := shadowState(t, home)
	if st.State != "needs-delta-login" || !strings.Contains(st.Detail, "delta auth login") || len(st.Joined) != 0 {
		t.Fatalf("state = %+v", st)
	}
	if prompts := readFile(filepath.Join(state, "prompts")); prompts != "" {
		t.Fatalf("joined while signed out: %s", prompts)
	}
}

// The thread is joined once: a prompt to Claude, recorded in the state file, and
// not repeated by later runs; a different link is joined too.
func TestStartShadowJoinsAThreadOnce(t *testing.T) {
	home, state, run := fakeShadowHome(t)
	for i := 0; i < 2; i++ {
		if out, err := run("SHADOW_DELTA_THREAD=" + testThread); err != nil {
			t.Fatalf("run %d: %v\n%s", i, err, out)
		}
	}
	if got := strings.TrimSpace(readFile(filepath.Join(state, "prompts"))); got != "/delta join "+testThread {
		t.Fatalf("prompts = %q", got)
	}
	if st := shadowState(t, home); st.State != "running" || len(st.Joined) != 1 || st.Joined[0] != testThread {
		t.Fatalf("state = %+v", st)
	}
	other := "https://delta.dev/join/thread_other"
	if out, err := run("SHADOW_DELTA_THREAD=" + other); err != nil {
		t.Fatalf("other thread: %v\n%s", err, out)
	}
	if n := strings.Count(readFile(filepath.Join(state, "prompts")), "/delta join"); n != 2 {
		t.Fatalf("%d joins, want 2", n)
	}
}
