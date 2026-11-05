package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func envOf(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

var claudeRelayEnv = map[string]string{
	"LINEAR_API_KEY":              "lin",
	"LINEAR_AGENT_RELAY_DIR":      "/data/relay",
	"LINEAR_AGENT_WEBHOOK_SECRET": "claude-secret",
	"LINEAR_AGENT_APP_USER_ID":    "claude-app",
	"LINEAR_AGENT_WEBHOOK_URL":    "https://agent.example/webhooks/linear",
}

func withEnv(base map[string]string, extra map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func TestAgentRelayConfigsKeepTheClaudeAgentAsItWas(t *testing.T) {
	got, problems := agentRelayConfigs(envOf(claudeRelayEnv))
	if len(problems) != 0 || len(got) != 1 {
		t.Fatalf("got %+v, problems %q", got, problems)
	}
	c := got[0]
	if c.route != "/linear/agent-webhook" || c.dir != "/data/relay" || c.secret != "claude-secret" ||
		c.appUserID != "claude-app" || c.label != "The Claude agent" {
		t.Fatalf("claude config %+v", c)
	}
}

func TestAgentRelayConfigsAddANamedAgentBesideIt(t *testing.T) {
	env := withEnv(claudeRelayEnv, map[string]string{
		"LINEAR_AGENTS":                          " openrouter , openrouter",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_SECRET": "or-secret",
		"LINEAR_AGENT_OPENROUTER_APP_USER_ID":    "or-app",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_URL":    "https://openrouter-agent.example/webhooks/linear",
		"LINEAR_AGENT_OPENROUTER_LABEL":          "The OpenRouter agent",
	})
	got, problems := agentRelayConfigs(envOf(env))
	if len(problems) != 0 || len(got) != 2 {
		t.Fatalf("got %+v, problems %q", got, problems)
	}
	o := got[1]
	if o.route != "/linear/agent-webhook/openrouter" || o.dir != filepath.Join("/data/relay", "openrouter") ||
		o.secret != "or-secret" || o.appUserID != "or-app" || o.label != "The OpenRouter agent" ||
		o.url != "https://openrouter-agent.example/webhooks/linear" {
		t.Fatalf("openrouter config %+v", o)
	}
}

func TestAgentRelayConfigsTurnOffOnlyTheIncompleteAgent(t *testing.T) {
	env := withEnv(claudeRelayEnv, map[string]string{
		"LINEAR_AGENTS":                          "openrouter,Bad_Name,quiet",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_SECRET": "or-secret",
		// No app user id, no URL; "quiet" has no secret at all.
	})
	got, problems := agentRelayConfigs(envOf(env))
	if len(got) != 1 || got[0].route != "/linear/agent-webhook" {
		t.Fatalf("got %+v", got)
	}
	joined := strings.Join(problems, "\n")
	if len(problems) != 2 ||
		!strings.Contains(joined, "LINEAR_AGENT_OPENROUTER_APP_USER_ID, LINEAR_AGENT_OPENROUTER_WEBHOOK_URL") ||
		!strings.Contains(joined, `"bad_name" is not a name`) {
		t.Fatalf("problems %q", problems)
	}

	// And a named agent works without the Claude agent being relayed.
	only := map[string]string{
		"LINEAR_API_KEY": "lin", "LINEAR_AGENT_RELAY_DIR": "/r", "LINEAR_AGENTS": "openrouter",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_SECRET": "s", "LINEAR_AGENT_OPENROUTER_APP_USER_ID": "a",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_URL": "https://x/webhooks/linear",
	}
	got, problems = agentRelayConfigs(envOf(only))
	if len(problems) != 0 || len(got) != 1 || got[0].label != "The openrouter agent" {
		t.Fatalf("got %+v, problems %q", got, problems)
	}
}

// Each agent's route takes only its own OAuth app's signature, so a second
// agent cannot be woken or fed with the first one's secret, or the reverse.
func TestEachAgentRouteVerifiesItsOwnAppSecret(t *testing.T) {
	root := t.TempDir()
	for k, v := range withEnv(claudeRelayEnv, map[string]string{
		"LINEAR_AGENT_RELAY_DIR":                 root,
		"LINEAR_AGENT_WEBHOOK_URL":               "http://127.0.0.1:1/unused",
		"LINEAR_AGENTS":                          "openrouter",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_SECRET": "or-secret",
		"LINEAR_AGENT_OPENROUTER_APP_USER_ID":    "or-app",
		"LINEAR_AGENT_OPENROUTER_WEBHOOK_URL":    "http://127.0.0.1:1/unused",
	}) {
		t.Setenv(k, v)
	}
	tb, _, _ := newTestToolbox("RUNNING")
	srv := httptest.NewServer(newMux("", "http://example.test", tb))
	defer srv.Close()
	post := func(path, secret string) int {
		t.Helper()
		req := signedRerunRequest(t, secret, "x-"+path+secret, []byte(`{"type":"Issue","webhookTimestamp":`+itoa(time.Now().UnixMilli())+`}`))
		hreq, _ := http.NewRequest(http.MethodPost, srv.URL+path, req.Body)
		hreq.Header = req.Header
		resp, err := http.DefaultClient.Do(hreq)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	for _, c := range []struct {
		path, secret string
		want         int
	}{
		{"/linear/agent-webhook", "claude-secret", http.StatusOK},
		{"/linear/agent-webhook/openrouter", "or-secret", http.StatusOK},
		{"/linear/agent-webhook/openrouter", "claude-secret", http.StatusUnauthorized},
		{"/linear/agent-webhook", "or-secret", http.StatusUnauthorized},
		{"/linear/agent-webhook/other", "or-secret", http.StatusNotFound},
	} {
		if got := post(c.path, c.secret); got != c.want {
			t.Errorf("%s signed with %s: %d, want %d", c.path, c.secret, got, c.want)
		}
	}
	if !writableDir(filepath.Join(root, "openrouter")) {
		t.Fatal("the openrouter agent's relay directory was not made")
	}
}

func TestRelayCommentsNameTheirAgent(t *testing.T) {
	h := newRelayHarness(t, t.TempDir())
	h.r.label = "The OpenRouter agent"
	if code := h.post(t, "d1", sessionBody(t, "created", "session-A", "issue-A", nil)); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	eventually(t, "delivery", func() bool { return len(h.agent.sessions()) == 1 })
	if len(h.rec.calls) != 1 || !strings.Contains(h.rec.calls[0], "The OpenRouter agent's host is starting") {
		t.Fatalf("issue comments = %q", h.rec.calls)
	}
}

// Two agents' delegations arriving together still wake the one host one
// step at a time, as two delegations to one agent do.
func TestAgentsShareOneWake(t *testing.T) {
	a, b := newRelayHarness(t, t.TempDir()), newRelayHarness(t, t.TempDir())
	shared := &sync.Mutex{}
	a.r.wakeMu, b.r.wakeMu = shared, shared
	var inWake, most atomic.Int32
	slow := func(real func(context.Context) (wakeOut, error)) func(context.Context) (wakeOut, error) {
		return func(ctx context.Context) (wakeOut, error) {
			n := inWake.Add(1)
			defer inWake.Add(-1)
			for {
				m := most.Load()
				if n <= m || most.CompareAndSwap(m, n) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			return real(ctx)
		}
	}
	a.r.wake, b.r.wake = slow(a.r.wake), slow(b.r.wake)
	a.post(t, "d-a", sessionBody(t, "created", "session-A", "issue-A", nil))
	b.post(t, "d-b", sessionBody(t, "created", "session-B", "issue-B", nil))
	eventually(t, "both delivered", func() bool { return len(a.agent.sessions()) == 1 && len(b.agent.sessions()) == 1 })
	if most.Load() != 1 {
		t.Fatalf("%d wakes ran at once", most.Load())
	}
}
