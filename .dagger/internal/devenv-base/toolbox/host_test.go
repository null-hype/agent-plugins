package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestExportsQuoteSecrets(t *testing.T) {
	got := exports(map[string]string{"B": "it's", "A": "x y"})
	want := "export A='x y'\nexport B='it'\\''s'\n"
	if got != want {
		t.Fatalf("exports = %q, want %q", got, want)
	}
	if cmd := hostCommand([]string{"up", "a b"}); cmd != "bash -s -- 'up' 'a b'" {
		t.Fatalf("hostCommand = %q", cmd)
	}
}

func TestHostKeysArePinned(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	k, _ := ssh.NewPublicKey(pub)
	other, _, _ := ed25519.GenerateKey(rand.Reader)
	o, _ := ssh.NewPublicKey(other)

	// Guest attributes carry the bare base64 key under the key type.
	keys, err := parseHostKeys([]struct{ Key, Value string }{
		{Key: k.Type(), Value: base64.StdEncoding.EncodeToString(k.Marshal())},
	})
	if err != nil {
		t.Fatal(err)
	}
	cb := pinnedHostKeys(keys)
	if err := cb("h", nil, k); err != nil {
		t.Fatalf("published key rejected: %v", err)
	}
	if err := cb("h", nil, o); err == nil {
		t.Fatal("unpublished key accepted")
	}
}

// TestHostScript runs host.sh against a fake devpod to check that every
// action prints JSON and that up detaches and records its exit code.
func TestHostScript(t *testing.T) {
	for _, tool := range []string{"bash", "jq", "setsid"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	os.Mkdir(bin, 0o755)
	// The fake devpod knows one stopped workspace, ws1, and logs its args.
	fake := `#!/bin/bash
echo "$*" >> "$HOME/devpod.calls"
case $1 in
list) echo '[{"id":"ws1"}]' ;;
status) [ "$2" = ws1 ] && echo '{"state":"Stopped"}' || exit 1 ;;
up) printf '\033[0;1;36minfo \033[0mup output\n' ;;
esac
`
	os.WriteFile(filepath.Join(bin, "devpod"), []byte(fake), 0o755)
	os.WriteFile(filepath.Join(bin, "git"), []byte("#!/bin/sh\n"), 0o755)

	run := func(env string, args ...string) string {
		t.Helper()
		cmd := exec.Command("bash", append([]string{"-s", "--"}, args...)...)
		cmd.Env = []string{"HOME=" + home, "PATH=" + bin + ":" + os.Getenv("PATH")}
		cmd.Stdin = strings.NewReader(env + hostScript)
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("host.sh %v: %v", args, err)
		}
		return strings.TrimSpace(string(out))
	}

	// Without tailscaled the host is still ready; the tailnet says why.
	os.WriteFile(filepath.Join(bin, "docker"), []byte("#!/bin/sh\n"), 0o755)
	os.WriteFile(filepath.Join(bin, "tailscale"), []byte("#!/bin/sh\nexit 1\n"), 0o755)
	ready := filepath.Join(home, "ready")
	os.WriteFile(ready, nil, 0o644)
	if got := run("export TOOLBOX_READY_FILE="+ready+"\n", "ping"); !strings.Contains(got, `"NotInstalled"`) {
		t.Fatalf("ping = %s", got)
	}

	if got := run("", "list"); strings.Join(strings.Fields(got), "") != `[{"name":"ws1","state":"Stopped","job_running":false}]` {
		t.Fatalf("list = %s", got)
	}
	run(exports(map[string]string{"GITHUB_TOKEN": "t"}), "up", "ws2", "main", "0")
	// Wait for the detached job to record its exit code.
	exitFile := filepath.Join(home, ".toolbox/jobs/ws2.exit")
	for i := 0; i < 100; i++ {
		if _, err := os.Stat(exitFile); err == nil {
			break
		}
		exec.Command("sleep", "0.05").Run()
	}
	status := run("", "status", "ws2")
	if !strings.Contains(status, `"job_exit": 0`) || !strings.Contains(status, `"log_tail": "info up output"`) {
		t.Fatalf("status = %s", status)
	}
	calls, _ := os.ReadFile(filepath.Join(home, "devpod.calls"))
	if !strings.Contains(string(calls), "up ws2 --id ws2 --source git:https://github.com/null-hype/agent-plugins.git@main --provider docker --ide none") {
		t.Fatalf("devpod calls:\n%s", calls)
	}
	if strings.Contains(string(calls), "GITHUB_TOKEN") || strings.Contains(string(calls), " t ") {
		t.Fatalf("token reached a devpod command line:\n%s", calls)
	}

	// An agent workspace's scripts run from origin/main.
	os.Remove(filepath.Join(home, "devpod.calls"))
	os.Remove(filepath.Join(home, ".toolbox/jobs/ws1.exit"))
	run(exports(map[string]string{"GITHUB_TOKEN": "t"}), "up", "ws1", "main", "1")
	exitFile = filepath.Join(home, ".toolbox/jobs/ws1.exit")
	for i := 0; i < 100; i++ {
		if _, err := os.Stat(exitFile); err == nil {
			break
		}
		exec.Command("sleep", "0.05").Run()
	}
	calls, _ = os.ReadFile(filepath.Join(home, "devpod.calls"))
	checkout := strings.Index(string(calls), "git checkout -q --detach origin/main")
	firstScript := strings.Index(string(calls), "generate-env-files.sh")
	if checkout < 0 || firstScript < checkout {
		t.Fatalf("checkout not moved to origin/main before the scripts:\n%s", calls)
	}
}

// TestHostShip runs host.sh's ship against real git: a local origin stands in
// for GitHub, a fake devpod runs its command in a local workspace whose
// container-use remote holds the environment, and a fake curl answers the
// pulls API.
func TestHostShip(t *testing.T) {
	for _, tool := range []string{"bash", "jq", "git", "base64"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	os.Mkdir(bin, 0o755)
	origin := filepath.Join(home, "origin.git")
	ws := filepath.Join(home, "ws")
	env := []string{"HOME=" + home, "PATH=" + bin + ":" + os.Getenv("PATH"),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t"}
	sh := func(dir, script string) string {
		t.Helper()
		cmd := exec.Command("bash", "-euo", "pipefail", "-c", script)
		cmd.Dir, cmd.Env = dir, env
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v\n%s", script, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	// origin: main, then base, then the issue branch one commit ahead of base.
	// The environment forked from base, so the issue branch moved on since.
	sh(home, `git init -q --bare -b main origin.git && git clone -q origin.git src && cd src &&
		echo a > a && git add a && git commit -qm main && git push -q origin main &&
		git switch -qc agent/x && echo b > b && git add b && git commit -qm base && git push -q origin agent/x &&
		git switch -qc cit-1-fix && echo finding > f && git add f && git commit -qm finding && git push -q origin cit-1-fix &&
		git clone -q ../origin.git ../cu && cd ../cu && git switch -qc trusty-burro origin/agent/x &&
		echo fix > b && git commit -qam "" --allow-empty-message &&
		git clone -q ../origin.git ../ws && cd ../ws && git remote add container-use ../cu`)
	os.WriteFile(filepath.Join(home, ".gitconfig"), []byte(
		"[url \""+origin+"\"]\n\tinsteadOf = https://github.com/null-hype/agent-plugins.git\n"), 0o644)
	os.WriteFile(filepath.Join(bin, "devpod"), []byte(`#!/bin/bash
echo "$*" >> "$HOME/devpod.calls"
[ "$1 $3" = "ssh --command" ] || exit 1
echo "devpod noise"
cmd=${4//\/workspaces\/$2/`+ws+`}
bash -c "${cmd//\/tmp\/ship.bundle/$HOME/ship.bundle}"
`), 0o755)
	os.WriteFile(filepath.Join(bin, "curl"), []byte(`#!/bin/bash
echo "$*" >> "$HOME/curl.calls"
case "$*" in
*"-X POST"*) cat > "$HOME/pr.json"; echo '{"html_url": "https://github.com/null-hype/agent-plugins/pull/9"}' ;;
*) echo '[]' ;;
esac
`), 0o755)

	ship := func(branch string) map[string]string {
		t.Helper()
		cmd := exec.Command("bash", "-s", "--", "ship", "linear-agent", "trusty-burro", branch, "agent/x", "Fix it (CIT-1)")
		cmd.Env = env
		cmd.Stdin = strings.NewReader(exports(map[string]string{"GITHUB_TOKEN": "s3cret"}) + hostScript)
		var stderr strings.Builder
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("ship %s: %v\n%s", branch, err, stderr.String())
		}
		var got map[string]string
		if err := json.Unmarshal(out, &got); err != nil {
			t.Fatalf("ship %s printed %q: %v", branch, out, err)
		}
		return got
	}

	got := ship("cit-1-fix")
	if got["pr"] != "https://github.com/null-hype/agent-plugins/pull/9" || !strings.Contains(got["diffstat"], "b | 2 +-") {
		t.Fatalf("ship = %v", got)
	}
	// One commit on top of the moved-on branch: its finding stays and the fix lands.
	if parent := sh(origin, "git rev-parse "+got["sha"]+"^"); parent != sh(home+"/src", "git rev-parse cit-1-fix") {
		t.Fatalf("shipped commit's parent is %s, not the issue branch's tip", parent)
	}
	if sh(origin, "git rev-parse cit-1-fix") != got["sha"] || sh(origin, "git show cit-1-fix:b") != "fix" || sh(origin, "git show cit-1-fix:f") != "finding" {
		t.Fatal("origin's issue branch does not hold both the finding and the fix")
	}
	pr, _ := os.ReadFile(filepath.Join(home, "pr.json"))
	if req := strings.Join(strings.Fields(string(pr)), ""); !strings.Contains(req, `"head":"cit-1-fix"`) || !strings.Contains(req, `"base":"agent/x"`) {
		t.Fatalf("PR request %s", pr)
	}

	// A branch that does not exist yet is created off base.
	got = ship("cit-2-fix")
	if parent := sh(origin, "git rev-parse "+got["sha"]+"^"); parent != sh(origin, "git rev-parse agent/x") {
		t.Fatalf("new branch's commit has parent %s, not base", parent)
	}

	for _, f := range []string{"devpod.calls", "curl.calls"} {
		if b, _ := os.ReadFile(filepath.Join(home, f)); strings.Contains(string(b), "s3cret") {
			t.Fatalf("token reached a command line in %s:\n%s", f, b)
		}
	}
}

// TestHostReview runs host.sh's review against real git, with a fake Codex
// that records its prompt, and checks the review is against the PR's own base.
func TestHostReview(t *testing.T) {
	for _, tool := range []string{"bash", "jq", "git", "setsid"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	os.Mkdir(bin, 0o755)
	origin := filepath.Join(home, "origin.git")
	env := []string{"HOME=" + home, "PATH=" + bin + ":" + os.Getenv("PATH"),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t"}
	// origin: main with the hk backup script, base on top, and the PR on base.
	setup := exec.Command("bash", "-euo", "pipefail", "-c", `git init -q --bare -b main origin.git && git clone -q origin.git src && cd src &&
		mkdir -p .dagger/internal/devenv-base/hk .dagger/internal/devenv-base/.devcontainer &&
		echo 'touch "$HOME/backup.ran"' > .dagger/internal/devenv-base/hk/claude-session-backup.sh &&
		touch .dagger/internal/devenv-base/.devcontainer/devcontainer.json &&
		git add . && git commit -qm main && git push -q origin main &&
		git switch -qc agent/x && echo b > b && git add b && git commit -qm base && git push -q origin agent/x &&
		git switch -qc cit-1 && echo c > c && git add c && git commit -qm pr && git push -q origin cit-1:refs/pull/7/head`)
	setup.Dir, setup.Env = home, env
	if out, err := setup.CombinedOutput(); err != nil {
		t.Fatalf("setup: %v\n%s", err, out)
	}
	os.WriteFile(filepath.Join(home, ".gitconfig"), []byte(
		"[url \""+origin+"\"]\n\tinsteadOf = https://github.com/null-hype/agent-plugins.git\n"), 0o644)
	for name, script := range map[string]string{
		"pass-cli": "exit 0",
		"curl": `echo "$*" >> "$HOME/curl.calls"
echo '{"base": {"ref": "agent/x"}}'`,
		"codex": `cat > "$HOME/prompt"
while [ "$1" != -o ]; do shift; done
echo "no findings" > "$2"`,
	} {
		os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/bash\n"+script+"\n"), 0o755)
	}

	cmd := exec.Command("bash", "-s", "--", "review", "7")
	cmd.Env = env
	cmd.Stdin = strings.NewReader(exports(map[string]string{"GITHUB_TOKEN": "s3cret"}) + hostScript)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("review: %v\n%s", err, out)
	}
	jobs := filepath.Join(home, ".toolbox", "jobs")
	var exit []byte
	for i := 0; i < 100 && len(exit) == 0; i++ {
		time.Sleep(100 * time.Millisecond)
		exit, _ = os.ReadFile(filepath.Join(jobs, "review-7.exit"))
	}
	if strings.TrimSpace(string(exit)) != "0" {
		log, _ := os.ReadFile(filepath.Join(jobs, "review-7.log"))
		t.Fatalf("review job exit %q\n%s", exit, log)
	}
	if prompt, _ := os.ReadFile(filepath.Join(home, "prompt")); !strings.Contains(string(prompt), "against origin/agent/x using") {
		t.Fatalf("Codex was not asked to review against the PR's base:\n%s", prompt)
	}
	check := exec.Command("git", "rev-parse", "--verify", "-q", "origin/agent/x")
	check.Dir, check.Env = filepath.Join(home, ".toolbox", "reviews", "7"), env
	if err := check.Run(); err != nil {
		t.Fatal("the review clone has no origin/agent/x for Codex to diff against")
	}
	if _, err := os.Stat(filepath.Join(home, "backup.ran")); err != nil {
		t.Fatal("the pre-push backup did not run")
	}
	if b, _ := os.ReadFile(filepath.Join(home, "curl.calls")); strings.Contains(string(b), "s3cret") {
		t.Fatalf("token reached curl's command line:\n%s", b)
	}
}
