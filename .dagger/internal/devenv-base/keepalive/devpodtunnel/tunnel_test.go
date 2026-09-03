package devpodtunnel

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// installFakeDevpod puts a fake `devpod` on PATH for the duration of the
// test: `devpod ssh <workspace>` and `devpod up <workspace>` both just
// `exec bash`, standing in for the real remote session. This is enough to
// exercise Tunnel's actual subprocess/pipe protocol (the done-marker
// scanning, one-process-per-session vs. one-process-per-step) against a
// real bash process, without any live devpod/GCP/workspace.
func installFakeDevpod(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	fakeDevpod := filepath.Join(dir, "devpod")
	script := "#!/bin/sh\nexec bash\n"
	if err := os.WriteFile(fakeDevpod, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake devpod: %v", err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func writeScript(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func TestTunnel_RunReportsOutputAndExitCode(t *testing.T) {
	installFakeDevpod(t)
	scriptsDir := t.TempDir()
	writeScript(t, scriptsDir, "ok.sh", "echo did-ok\nexit 0\n")
	writeScript(t, scriptsDir, "fail.sh", "echo did-fail\nexit 3\n")

	tun := New("workspace-id")
	tun.ScriptsDir = scriptsDir
	ctx := context.Background()

	if err := tun.Open(ctx); err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tun.Close()

	out, err := tun.Run(ctx, "ok.sh")
	if err != nil {
		t.Fatalf("Run(ok.sh) unexpected error: %v", err)
	}
	if !strings.Contains(out, "did-ok") {
		t.Fatalf("Run(ok.sh) output = %q, want it to contain %q", out, "did-ok")
	}

	out, err = tun.Run(ctx, "fail.sh")
	if err == nil {
		t.Fatal("Run(fail.sh) expected a non-nil error for exit 3")
	}
	if !strings.Contains(out, "did-fail") {
		t.Fatalf("Run(fail.sh) output = %q, want it to contain %q", out, "did-fail")
	}
}

func TestTunnel_RunsMultipleStepsOverOneSession(t *testing.T) {
	installFakeDevpod(t)
	scriptsDir := t.TempDir()
	writeScript(t, scriptsDir, "one.sh", "echo one\nexit 0\n")
	writeScript(t, scriptsDir, "two.sh", "echo two\nexit 0\n")

	tun := New("workspace-id")
	tun.ScriptsDir = scriptsDir
	ctx := context.Background()

	if err := tun.Open(ctx); err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tun.Close()

	pid := tun.cmd.Process.Pid

	if _, err := tun.Run(ctx, "one.sh"); err != nil {
		t.Fatalf("Run(one.sh): %v", err)
	}
	if _, err := tun.Run(ctx, "two.sh"); err != nil {
		t.Fatalf("Run(two.sh): %v", err)
	}

	if tun.cmd.Process.Pid != pid {
		t.Fatalf("session process changed across steps (pid %d -> %d) -- each step should run over the one long-lived session, not spawn its own", pid, tun.cmd.Process.Pid)
	}
}

func TestTunnel_RestartOpensAFreshSession(t *testing.T) {
	installFakeDevpod(t)
	scriptsDir := t.TempDir()
	writeScript(t, scriptsDir, "ok.sh", "echo ok\nexit 0\n")

	tun := New("workspace-id")
	tun.ScriptsDir = scriptsDir
	ctx := context.Background()

	if err := tun.Open(ctx); err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer tun.Close()
	firstPid := tun.cmd.Process.Pid

	if err := tun.Restart(ctx); err != nil {
		t.Fatalf("Restart: %v", err)
	}
	if tun.cmd == nil || tun.cmd.Process == nil {
		t.Fatal("Restart left no session open")
	}
	if tun.cmd.Process.Pid == firstPid {
		t.Fatal("Restart should replace the session process, not reuse the old one")
	}

	if _, err := tun.Run(ctx, "ok.sh"); err != nil {
		t.Fatalf("Run after Restart: %v", err)
	}
}

func TestTunnel_RunBeforeOpenFails(t *testing.T) {
	installFakeDevpod(t)
	tun := New("workspace-id")
	if _, err := tun.Run(context.Background(), "ok.sh"); err == nil {
		t.Fatal("expected Run before Open to fail")
	}
}
