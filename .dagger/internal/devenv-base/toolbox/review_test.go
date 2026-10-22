package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestReviewJobExit runs host.sh's review action against fake codex, git and
// pass-cli. A review with no findings succeeds; a broken Codex or push fails.
func TestReviewJobExit(t *testing.T) {
	for _, tool := range []string{"bash", "jq", "setsid"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s not installed", tool)
		}
	}
	const finding = "major-rabbit, CIT-9, cit-9-a-finding, A finding\n"
	cases := []struct {
		name      string
		codexOut  string
		codexExit string
		pushFails bool
		wantExit  string
		wantPush  bool
	}{
		{name: "empty output", wantExit: "0"},
		{name: "prose without findings", codexOut: "No findings.\n", wantExit: "0"},
		{name: "finding is pushed", codexOut: finding, wantExit: "0", wantPush: true},
		{name: "codex fails", codexExit: "3", wantExit: "3"},
		{name: "codex fails with findings", codexOut: finding, codexExit: "3", wantExit: "3"},
		{name: "push fails", codexOut: finding, pushFails: true, wantExit: "1", wantPush: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			bin := filepath.Join(home, "bin")
			os.Mkdir(bin, 0o755)
			write := func(name, body string) {
				os.WriteFile(filepath.Join(bin, name), []byte(body), 0o755)
			}
			write("pass-cli", "#!/bin/sh\n")
			write("codex", `#!/bin/bash
while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
cat > /dev/null
printf '%s' "$FAKE_CODEX_OUT" > "$out"
exit "${FAKE_CODEX_EXIT:-0}"
`)
			write("git", `#!/bin/bash
echo "$*" >> "$HOME/git.calls"
[ "$1" = clone ] && mkdir -p "${@: -1}"
[ "$1" = push ] && [ -n "$FAKE_PUSH_FAILS" ] && exit 1
exit 0
`)
			env := exports(map[string]string{
				"GITHUB_TOKEN":    "t",
				"FAKE_CODEX_OUT":  tc.codexOut,
				"FAKE_CODEX_EXIT": tc.codexExit,
			})
			if tc.pushFails {
				env += exports(map[string]string{"FAKE_PUSH_FAILS": "1"})
			}
			run := func(args ...string) string {
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

			run("review", "7")
			exitFile := filepath.Join(home, ".toolbox/jobs/review-7.exit")
			for i := 0; i < 100; i++ {
				if _, err := os.Stat(exitFile); err == nil {
					break
				}
				exec.Command("sleep", "0.05").Run()
			}
			status := run("review-status", "7")
			if want := `"job_exit": ` + tc.wantExit + ","; !strings.Contains(status, want) {
				t.Fatalf("want %s in review-status = %s", want, status)
			}
			calls, _ := os.ReadFile(filepath.Join(home, "git.calls"))
			pushed := strings.Contains(string(calls), "push -q origin FETCH_HEAD:refs/heads/cit-9-a-finding")
			if pushed != tc.wantPush {
				t.Fatalf("pushed = %v, want %v; git calls:\n%s", pushed, tc.wantPush, calls)
			}
		})
	}
}
