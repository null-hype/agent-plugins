package main

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestBootstrapStopsAtEachFailure(t *testing.T) {
	commands := []string{"generate-env-files.sh", "tailscale-up.sh", "tailscale status", "install-tools.sh", "start-linear-agent.sh", "127.0.0.1:8080/healthz", "start-cloudflared.sh", "agent.tidelands.dev/healthz", "check-linear-agent-webhook-live.sh"}
	for fail := -1; fail < len(commands); fail++ {
		calls := 0
		cause := errors.New("remote failure")
		run := func(_ context.Context, command string, env map[string]string) ([]byte, error) {
			index := calls
			calls++
			if index >= len(commands) || !strings.Contains(command, commands[index]) {
				t.Fatalf("unexpected command %d: %s", index, command)
			}
			if index == 1 {
				if env["PROTON_PASS_PERSONAL_ACCESS_TOKEN"] != "test-token" {
					t.Fatal("missing container authentication")
				}
			} else if len(env) != 0 {
				t.Fatal("token passed to unrelated command")
			}
			if index == fail {
				return nil, cause
			}
			if index == 2 {
				return []byte(`{"BackendState":"Running","Self":{"Online":true,"TailscaleIPs":["100.64.0.1"]}}`), nil
			}
			if index == 5 || index == 7 {
				return []byte(`{"installTokenConfigured":true}`), nil
			}
			return nil, nil
		}
		err := bootstrap(context.Background(), run, ".devcontainer", "test-token")
		if fail == -1 {
			if err != nil || calls != len(commands) {
				t.Fatalf("success: calls=%d err=%v", calls, err)
			}
		} else if !errors.Is(err, cause) || calls != fail+1 {
			t.Fatalf("failure %d: calls=%d err=%v", fail, calls, err)
		}
	}
}

func TestTailnetMustBeOnline(t *testing.T) {
	for _, raw := range []string{`{}`, `not json`, `{"BackendState":"NeedsLogin"}`, `{"BackendState":"Running","Self":{"Online":false,"TailscaleIPs":["100.64.0.1"]}}`, `{"BackendState":"Running","Self":{"Online":true}}`} {
		if checkTailnet([]byte(raw)) == nil {
			t.Fatalf("accepted offline state %s", raw)
		}
	}
}

func TestAgentHealthRequiresInstallToken(t *testing.T) {
	for _, raw := range []string{`{}`, `not json`, `{"installTokenConfigured":false}`} {
		run := func(context.Context, string, map[string]string) ([]byte, error) { return []byte(raw), nil }
		if checkAgent(context.Background(), run, "http://localhost/healthz") == nil {
			t.Fatalf("accepted unhealthy agent %s", raw)
		}
	}
}

func TestBootstrapRequiresTokenBeforeExecuting(t *testing.T) {
	run := func(context.Context, string, map[string]string) ([]byte, error) {
		t.Fatal("executed without token")
		return nil, nil
	}
	if bootstrap(context.Background(), run, ".devcontainer", "") == nil {
		t.Fatal("accepted missing token")
	}
}
