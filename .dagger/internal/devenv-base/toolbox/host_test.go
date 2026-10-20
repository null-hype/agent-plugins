package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
// container-use remote holds the environments, a fake container-use merges
// as the real one does, and a fake Codex runs the two commands it is asked to.
func TestHostShip(t *testing.T) {
	for _, tool := range []string{"bash", "jq", "git", "base64", "setsid"} {
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
	// origin: main, and the issue branch one commit ahead of it (a review
	// finding's branch). Two environments forked from main, in the
	// container-use remote of the workspace's checkout.
	sh(home, `git init -q --bare -b main origin.git && git clone -q origin.git src && cd src &&
		echo a > a && git add a && git commit -qm main && git push -q origin main &&
		git switch -qc cit-1-fix && echo finding > f && git add f && git commit -qm finding && git push -q origin cit-1-fix &&
		git init -q --bare ../cu.git &&
		for e in trusty-burro quiet-fox; do
			git switch -qc $e main && echo $e > b-$e && git add b-$e && git commit -qm $e && git push -q ../cu.git $e
		done &&
		mkdir workspaces && git clone -q ../origin.git ../workspaces/linear-agent && cd ../workspaces/linear-agent &&
		git remote add container-use "$(cd ../.. && pwd)/cu.git"`)
	// The workspace's /workspaces is $HOME/workspaces here.
	os.WriteFile(filepath.Join(bin, "devpod"), []byte(`#!/bin/bash
echo "$*" >> "$HOME/devpod.calls"
[ "$1" = ssh ] || exit 1
case "$*" in *--send-env\ SHIP_PUSH_PAT*) echo "${SHIP_PUSH_PAT:+token}" >> "$HOME/devpod.sent" ;; esac
shift 2
while [ "$1" != --command ]; do shift; done
echo "devpod noise"
bash -c "${2//\/workspaces\//$HOME/workspaces/}" </dev/null
`), 0o755)
	os.WriteFile(filepath.Join(bin, "container-use"), []byte(`#!/bin/bash
[ "$1" = merge ] && git merge --no-ff --autostash -m "Merge environment $2" -- "container-use/$2"
`), 0o755)
	os.WriteFile(filepath.Join(bin, "codex"), []byte(`#!/bin/bash
echo "$*" > "$HOME/codex.args"
env > "$HOME/codex.env"
cp "$CODEX_HOME/rules/default.rules" "$HOME/codex.rules"
prompt=$(cat)
while [ "$1" != -o ]; do shift; done
[ -n "${FAKE_CODEX_IDLE:-}" ] || sed -nE 's/^[12]\. ([^ ]+).*/\1/p' <<< "$prompt" | while read -r cmd; do "$cmd" || exit 1; done
echo done > "$2"
`), 0o755)

	// The fake pass-cli has a session unless FAKE_PASS_DOWN is set, and
	// resolves every pass:// reference in an env file to s3cret, as the real
	// one resolves the push token. It logs its arguments and key provider.
	os.WriteFile(filepath.Join(bin, "pass-cli"), []byte(`#!/bin/bash
echo "$* [provider=${PROTON_PASS_KEY_PROVIDER:-}]" >> "$HOME/pass.calls"
case $1 in
info) [ -z "${FAKE_PASS_DOWN:-}" ] ;;
run)
	shift
	while [ "$1" != -- ]; do [ "$1" = --env-file ] && f=$2; shift; done
	shift
	while IFS== read -r k v; do [ "${v#pass://}" = "$v" ] || export "$k=s3cret"; done < "$f"
	exec "$@"
	;;
esac
`), 0o755)

	ship := func(envID, branch string, extra ...string) (exit string, result map[string]string) {
		t.Helper()
		cmd := exec.Command("bash", "-s", "--", "ship", "linear-agent", envID, branch)
		cmd.Env = append(append([]string{}, env...), extra...)
		cmd.Stdin = strings.NewReader(hostScript)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("ship %s: %v\n%s", branch, err, out)
		}
		jobs := filepath.Join(home, ".toolbox", "jobs")
		var b []byte
		for i := 0; i < 100 && len(b) == 0; i++ {
			time.Sleep(100 * time.Millisecond)
			b, _ = os.ReadFile(filepath.Join(jobs, "ship.exit"))
		}
		if r, err := os.ReadFile(filepath.Join(jobs, "ship.json")); err == nil {
			json.Unmarshal(r, &result)
		}
		return strings.TrimSpace(string(b)), result
	}
	jobLog := func() string {
		b, _ := os.ReadFile(filepath.Join(home, ".toolbox", "jobs", "ship.log"))
		return string(b)
	}

	exit, got := ship("trusty-burro", "cit-1-fix")
	if exit != "0" || got["status"] != "pushed" {
		t.Fatalf("ship exit %q result %v\n%s", exit, got, jobLog())
	}
	// A fast-forward of the finding's branch, holding the finding and the fix.
	tip := sh(origin, "git rev-parse cit-1-fix")
	if got["sha"] != tip || sh(origin, "git show cit-1-fix:b-trusty-burro") != "trusty-burro" || sh(origin, "git show cit-1-fix:f") != "finding" {
		t.Fatalf("origin's cit-1-fix is %s, ship said %v", tip, got)
	}
	if first := sh(origin, "git rev-parse cit-1-fix^1"); first != sh(home+"/src", "git rev-parse cit-1-fix") {
		t.Fatalf("the merge's first parent is %s, not the finding's commit", first)
	}
	if _, err := os.Stat(filepath.Join(home, "workspaces", "ship-trusty-burro")); err == nil {
		t.Error("the ship worktree was left behind")
	}

	args, _ := os.ReadFile(filepath.Join(home, "codex.args"))
	for _, want := range []string{`sandbox_mode="read-only"`, `approval_policy="never"`, "include_only"} {
		if !strings.Contains(string(args), want) {
			t.Errorf("codex was run without %s: %s", want, args)
		}
	}
	if strings.Contains(string(args), "SHIP_PUSH_PAT") {
		t.Errorf("codex's shell may see the push token: %s", args)
	}
	// The rules allow two scripts and nothing else; the scripts hold the
	// merge and the push to the branch, whatever arguments they are given.
	rules, _ := os.ReadFile(filepath.Join(home, "codex.rules"))
	patterns := regexp.MustCompile(`(?m)^    pattern = (.*),$`).FindAllStringSubmatch(string(rules), -1)
	if len(patterns) != 2 || strings.Count(string(rules), "prefix_rule(") != 2 {
		t.Fatalf("rules:\n%s", rules)
	}
	bin2 := filepath.Join(home, ".toolbox", "ship", "bin")
	for i, script := range []string{"ship-merge", "ship-push"} {
		if want := `["` + filepath.Join(bin2, script) + `"]`; patterns[i][1] != want {
			t.Errorf("rule %d is %s, want %s", i, patterns[i][1], want)
		}
	}
	for script, want := range map[string]string{
		"ship-merge": "exec devpod ssh linear-agent --command 'cd /workspaces/ship-trusty-burro && container-use merge trusty-burro'\n",
		"ship-push":  "export PROTON_PASS_KEY_PROVIDER=fs\nexec pass-cli run --env-file " + filepath.Join(home, ".toolbox", "ship", "ship.env") + " -- devpod ssh linear-agent --send-env SHIP_PUSH_PAT --command 'cd /workspaces/ship-trusty-burro && git -c credential.helper= -c credential.helper=/workspaces/.ship-git-credential push origin HEAD:refs/heads/cit-1-fix'\n",
	} {
		if b, _ := os.ReadFile(filepath.Join(bin2, script)); string(b) != "#!/bin/bash\n"+want {
			t.Errorf("%s is %q", script, b)
		}
	}

	// Shipping again finds the environment already on the branch and does not ask Codex.
	os.Remove(filepath.Join(home, "codex.args"))
	exit, got = ship("trusty-burro", "cit-1-fix")
	if _, err := os.Stat(filepath.Join(home, "codex.args")); exit != "0" || got["status"] != "already on the branch" || got["sha"] != tip || err == nil {
		t.Fatalf("second ship: exit %q result %v codex ran %t\n%s", exit, got, err == nil, jobLog())
	}

	// A Codex that does nothing leaves the environment off the branch: the
	// job fails and reports no result. Then a branch that does not exist yet
	// is created off main.
	exit, got = ship("quiet-fox", "cit-2-fix", "FAKE_CODEX_IDLE=1")
	if exit == "0" || exit == "" || got != nil {
		t.Fatalf("a ship Codex did not do: exit %q result %v\n%s", exit, got, jobLog())
	}
	exit, got = ship("quiet-fox", "cit-2-fix")
	if exit != "0" || got["status"] != "pushed" || got["sha"] != sh(origin, "git rev-parse cit-2-fix") {
		t.Fatalf("new branch: exit %q result %v\n%s", exit, got, jobLog())
	}
	if first := sh(origin, "git rev-parse cit-2-fix^1"); first != sh(origin, "git rev-parse main") {
		t.Fatalf("the new branch's merge has first parent %s, not main", first)
	}

	// The token is in the environment of the push and of the check that reads
	// GitHub, and nowhere else: not on a command line, not in Codex's.
	if b, _ := os.ReadFile(filepath.Join(home, "devpod.calls")); strings.Contains(string(b), "s3cret") {
		t.Fatalf("the push token reached a command line:\n%s", b)
	}
	if b, _ := os.ReadFile(filepath.Join(home, "codex.env")); strings.Contains(string(b), "s3cret") {
		t.Fatalf("the push token is in Codex's environment:\n%s", b)
	}
	if b, _ := os.ReadFile(filepath.Join(home, "devpod.sent")); strings.Contains(string(b), "\n\n") || strings.Count(string(b), "token") != strings.Count(string(b), "\n") || len(b) == 0 {
		t.Fatalf("devpod was asked to forward the token without having it:\n%s", b)
	}

	// The token is resolved with pass-cli run from a file of references: once
	// for each ship-push and once for each check, never from a file on the
	// host. ship.env holds the reference and nothing else, and no file under
	// the host's home holds the token.
	shipEnv := filepath.Join(home, ".toolbox", "ship", "ship.env")
	if b, _ := os.ReadFile(shipEnv); string(b) != "SHIP_PUSH_PAT=pass://infra/github.com/GITHUB_TOKEN\n" {
		t.Fatalf("ship.env is %q", b)
	}
	if _, err := os.Stat(filepath.Join(home, ".toolbox", "ship", "push-token")); err == nil {
		t.Error("a plaintext push-token file is on the host")
	}
	passCalls, _ := os.ReadFile(filepath.Join(home, "pass.calls"))
	resolve := "run --env-file " + shipEnv + " -- devpod ssh linear-agent --send-env SHIP_PUSH_PAT "
	if n := strings.Count(string(passCalls), resolve); n < 4 {
		t.Fatalf("the token was resolved through pass-cli run %d times, want a push and a check for each of two ships:\n%s", n, passCalls)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(passCalls)), "\n") {
		if !strings.HasSuffix(line, "[provider=fs]") {
			t.Errorf("pass-cli ran without the fs key provider: %s", line)
		}
		if strings.Contains(line, "s3cret") {
			t.Errorf("the push token reached pass-cli's command line: %s", line)
		}
	}
	filepath.WalkDir(home, func(path string, d os.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			if b, _ := os.ReadFile(path); strings.Contains(string(b), "s3cret") {
				t.Errorf("the push token is in a file on the host: %s", path)
			}
		}
		return nil
	})

	// With no Proton Pass session the ship is refused before anything starts:
	// no job, no Codex.
	os.Remove(filepath.Join(home, "codex.args"))
	os.Remove(filepath.Join(home, ".toolbox", "jobs", "ship.exit"))
	cmd := exec.Command("bash", "-s", "--", "ship", "linear-agent", "quiet-fox", "cit-3-fix")
	cmd.Env = append(append([]string{}, env...), "FAKE_PASS_DOWN=1")
	cmd.Stdin = strings.NewReader(hostScript)
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "no Proton Pass session on this host") {
		t.Fatalf("ship without a pass session: err %v\n%s", err, out)
	}
	time.Sleep(300 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(home, ".toolbox", "jobs", "ship.exit")); err == nil {
		t.Error("a ship job started without a pass session")
	}
	if _, err := os.Stat(filepath.Join(home, "codex.args")); err == nil {
		t.Error("Codex ran without a pass session")
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
