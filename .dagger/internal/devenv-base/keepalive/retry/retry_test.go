package retry

import (
	"context"
	"errors"
	"strings"
	"testing"

	"dagger/devenv-base/keepalive/core"
)

func TestClassifyTailscaleUp(t *testing.T) {
	cases := []struct {
		name   string
		output string
		err    error
		want   TailscaleOutcome
	}{
		{"nil error is always success", "anything at all", nil, TailscaleSuccess},
		{"workspace is stopped", "Error: workspace is stopped", errors.New("exit 1"), TailscaleWorkspaceStopped},
		{"doesnt exist", "workspace doesnt exist", errors.New("exit 1"), TailscaleWorkspaceStopped},
		{"does not exist", "workspace does not exist", errors.New("exit 1"), TailscaleWorkspaceStopped},
		{"already connected despite error", "tailscale: already connected", errors.New("cosmetic teardown"), TailscaleSuccess},
		{"joined tailnet despite error", "tailscale: joined tailnet", errors.New("cosmetic teardown"), TailscaleSuccess},
		{"unrecognized failure", "some random tailscale error", errors.New("exit 1"), TailscaleFailure},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyTailscaleUp(tc.output, tc.err); got != tc.want {
				t.Errorf("ClassifyTailscaleUp(%q, %v) = %v, want %v", tc.output, tc.err, got, tc.want)
			}
		})
	}
}

func succeed(script string) core.FakeResponse {
	return core.FakeResponse{Output: "did " + script}
}

func fail(script, output string) core.FakeResponse {
	return core.FakeResponse{Output: output, Err: errors.New(script + " failed")}
}

func happyPathResponses() map[string][]core.FakeResponse {
	return map[string][]core.FakeResponse{
		"generate-env-files.sh": {succeed("generate-env-files.sh")},
		"tailscale-up.sh":       {succeed("tailscale-up.sh")},
		"install-tools.sh":      {succeed("install-tools.sh")},
		"start-linear-agent.sh": {succeed("start-linear-agent.sh")},
		"start-cloudflared.sh":  {succeed("start-cloudflared.sh")},
	}
}

func TestRunBootstrap_HappyPath(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()

	if err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"}); err != nil {
		t.Fatalf("RunBootstrap returned error: %v", err)
	}
	if tunnel.Restarts != 0 {
		t.Fatalf("expected no restarts on the happy path, got %d", tunnel.Restarts)
	}
}

func TestRunBootstrap_ToleratesGenerateEnvFilesFailure(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	tunnel.Responses["generate-env-files.sh"] = []core.FakeResponse{fail("generate-env-files.sh", "boom")}

	if err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"}); err != nil {
		t.Fatalf("expected generate-env-files.sh failure to be tolerated, got error: %v", err)
	}
}

func TestRunBootstrap_TailscaleFailureToleratedOnFirstAttempt(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	tunnel.Responses["tailscale-up.sh"] = []core.FakeResponse{
		fail("tailscale-up.sh", "some unrelated tailscale error"),
	}

	if err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"}); err != nil {
		t.Fatalf("expected a non-workspace-stopped tailscale failure to be tolerated on the first attempt, got: %v", err)
	}
	if tunnel.Restarts != 0 {
		t.Fatalf("a non-workspace-stopped failure must not trigger Restart, got %d restarts", tunnel.Restarts)
	}
}

func TestRunBootstrap_WorkspaceStoppedTriggersRestartAndRelogin(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	// First tailscale-up.sh call: workspace stopped. Second call (post
	// Restart): success. generate-env-files.sh needs a second queued
	// response too, since it's re-run after Restart.
	tunnel.Responses["tailscale-up.sh"] = []core.FakeResponse{
		fail("tailscale-up.sh", "Error: workspace is stopped"),
		succeed("tailscale-up.sh"),
	}
	tunnel.Responses["generate-env-files.sh"] = []core.FakeResponse{
		succeed("generate-env-files.sh"),
		succeed("generate-env-files.sh"),
	}

	if err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"}); err != nil {
		t.Fatalf("RunBootstrap returned error: %v", err)
	}
	if tunnel.Restarts != 1 {
		t.Fatalf("expected exactly 1 restart, got %d", tunnel.Restarts)
	}

	runCount := func(script string) int {
		n := 0
		for _, c := range tunnel.Calls {
			if c == "run:"+script {
				n++
			}
		}
		return n
	}
	if n := runCount("tailscale-up.sh"); n != 2 {
		t.Fatalf("expected tailscale-up.sh to run twice (before and after restart), got %d", n)
	}
	if n := runCount("generate-env-files.sh"); n != 2 {
		t.Fatalf("expected generate-env-files.sh to run twice (before and after restart), got %d", n)
	}
}

func TestRunBootstrap_NewContainerHasNoPassCliSessionFailsRunWithoutProceeding(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	tunnel.Responses["tailscale-up.sh"] = []core.FakeResponse{
		fail("tailscale-up.sh", "Error: workspace is stopped"),
		fail("tailscale-up.sh", "still no session"), // post-restart retry also fails
	}
	tunnel.Responses["generate-env-files.sh"] = []core.FakeResponse{
		succeed("generate-env-files.sh"),
		succeed("generate-env-files.sh"),
	}

	err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"})
	if err == nil {
		t.Fatal("expected RunBootstrap to fail when tailscale-up.sh still fails after devpod up")
	}
	if !strings.Contains(err.Error(), "no pass-cli session") {
		t.Fatalf("error = %v, want it to explain the no-pass-cli-session failure mode", err)
	}
	for _, c := range tunnel.Calls {
		if c == "run:install-tools.sh" || c == "run:start-linear-agent.sh" || c == "run:start-cloudflared.sh" {
			t.Fatalf("RunBootstrap must not proceed to %s once tailscale-up.sh is unrecoverable, but Calls = %v", c, tunnel.Calls)
		}
	}
}

func TestRunBootstrap_AgentFailureFailsRun(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	tunnel.Responses["start-linear-agent.sh"] = []core.FakeResponse{fail("start-linear-agent.sh", "no active session")}

	err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"})
	if err == nil || !strings.Contains(err.Error(), "start-linear-agent.sh") {
		t.Fatalf("expected an error mentioning start-linear-agent.sh, got %v", err)
	}
}

func TestRunBootstrap_CloudflaredFailureFailsRun(t *testing.T) {
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	tunnel.Responses["start-cloudflared.sh"] = []core.FakeResponse{fail("start-cloudflared.sh", "boom")}

	err := RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"})
	if err == nil || !strings.Contains(err.Error(), "start-cloudflared.sh") {
		t.Fatalf("expected an error mentioning start-cloudflared.sh, got %v", err)
	}
}

func TestRunBootstrap_BothAgentAndCloudflaredRunEvenIfAgentFails(t *testing.T) {
	// Matches the shell script: both steps always run (start-cloudflared.sh
	// isn't gated on start-linear-agent.sh's result), failure is only
	// evaluated after both have run.
	tunnel := core.NewFakeTunnel()
	tunnel.Responses = happyPathResponses()
	tunnel.Responses["start-linear-agent.sh"] = []core.FakeResponse{fail("start-linear-agent.sh", "boom")}

	_ = RunBootstrap(context.Background(), tunnel, Deps{ProtonPassToken: "tok"})

	found := false
	for _, c := range tunnel.Calls {
		if c == "run:start-cloudflared.sh" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected start-cloudflared.sh to still run despite start-linear-agent.sh failing, Calls = %v", tunnel.Calls)
	}
}
