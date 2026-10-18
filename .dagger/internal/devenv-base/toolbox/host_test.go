package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

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
}
