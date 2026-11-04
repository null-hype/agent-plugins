package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	appUser        = "app-user-1"
	agentSecretVal = "agent-secret"
)

// agentRecorder is the agent's own webhook as the relay sees it.
type agentRecorder struct {
	mu   sync.Mutex
	got  []agentSessionEvent
	hdr  []http.Header
	sigs []bool
	code int
}

func (a *agentRecorder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body := new(bytes.Buffer)
	_, _ = body.ReadFrom(r.Body)
	mac := hmac.New(sha256.New, []byte(agentSecretVal))
	mac.Write(body.Bytes())
	var ev agentSessionEvent
	_ = json.Unmarshal(body.Bytes(), &ev)
	a.mu.Lock()
	defer a.mu.Unlock()
	a.got = append(a.got, ev)
	a.hdr = append(a.hdr, r.Header)
	a.sigs = append(a.sigs, hex.EncodeToString(mac.Sum(nil)) == r.Header.Get("Linear-Signature") &&
		absDuration(time.Since(time.UnixMilli(ev.WebhookTimestamp))) < time.Minute)
	if a.code != 0 {
		http.Error(w, "agent down", a.code)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (a *agentRecorder) sessions() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []string
	for _, e := range a.got {
		out = append(out, e.AgentSession.ID)
	}
	return out
}

// startCounter is a stopped VM that boots when started, counting starts.
type startCounter struct {
	fakeGCE
	mu     sync.Mutex
	starts int
}

func (s *startCounter) Instance(context.Context) (instance, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return instance{Status: s.status, IP: "203.0.113.7"}, nil
}
func (s *startCounter) Start(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.starts++
	s.status = "RUNNING"
	return nil
}

func sessionBody(t *testing.T, action, session, issue string, mutate func(map[string]any)) []byte {
	t.Helper()
	m := map[string]any{
		"type": "AgentSessionEvent", "action": action, "appUserId": appUser,
		"webhookTimestamp": time.Now().UnixMilli(),
		"agentSession":     map[string]any{"id": session, "status": "pending", "issueId": issue, "appUserId": appUser},
	}
	if mutate != nil {
		mutate(m)
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type relayHarness struct {
	r        *delegationRelay
	h        http.Handler
	agent    *agentRecorder
	gce      *startCounter
	rec      *linearRecorder
	delegate atomic.Value
}

// newRelayHarness wires the real wake against a stopped VM and a fake host
// whose agent comes up as soon as it is looked at after the VM boots.
func newRelayHarness(t *testing.T, dir string) *relayHarness {
	t.Helper()
	g := &startCounter{fakeGCE: fakeGCE{status: "TERMINATED"}}
	host := &fakeHost{agentLive: true, agentStatus: `{"state":"Running","job_running":false,"job_exit":0}`}
	tb := &toolbox{gce: g, host: host, githubToken: "gh", passToken: "pass"}
	rec := &linearRecorder{}
	lsrv := httptest.NewServer(rec)
	t.Cleanup(lsrv.Close)
	agent := &agentRecorder{}
	asrv := httptest.NewServer(agent)
	t.Cleanup(asrv.Close)
	r := newDelegationRelay(tb, &linearAPI{client: lsrv.Client(), url: lsrv.URL, key: "lin"}, appUser, asrv.URL, agentSecretVal, dir)
	r.poll, r.timeout = time.Millisecond, 2*time.Second
	hh := &relayHarness{r: r, h: delegationHandler("hook-secret", r), agent: agent, gce: g, rec: rec}
	hh.delegate.Store(appUser)
	r.delegate = func(context.Context, string) (string, error) { return hh.delegate.Load().(string), nil }
	return hh
}

func (h *relayHarness) post(t *testing.T, delivery string, body []byte) int {
	t.Helper()
	rr := httptest.NewRecorder()
	h.h.ServeHTTP(rr, signedDelegation(t, "hook-secret", delivery, body))
	return rr.Code
}

func signedDelegation(t *testing.T, secret, delivery string, body []byte) *http.Request {
	req := signedRerunRequest(t, secret, delivery, body)
	req.URL.Path = "/linear/agent-webhook"
	return req
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func (h *relayHarness) quiet(t *testing.T) {
	t.Helper()
	time.Sleep(100 * time.Millisecond)
}

// A delegation received while the VM is stopped is acknowledged at once,
// starts the VM, and reaches the agent, for that session, once it answers.
func TestDelegationWhileVMStoppedIsRetainedAndDelivered(t *testing.T) {
	h := newRelayHarness(t, t.TempDir())
	if code := h.post(t, "d1", sessionBody(t, "created", "session-A", "issue-A", nil)); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	eventually(t, "delivery", func() bool { return len(h.agent.sessions()) == 1 })
	if got := h.agent.sessions()[0]; got != "session-A" {
		t.Fatalf("delivered session %q", got)
	}
	if h.gce.starts != 1 || !h.agent.sigs[0] || h.agent.hdr[0].Get("Linear-Event") != "AgentSessionEvent" {
		t.Fatalf("starts=%d signed=%v hdr=%v", h.gce.starts, h.agent.sigs, h.agent.hdr[0])
	}
	// The host was told nothing but the existing wake calls: no new orchestrator.
	if files, _ := filepath.Glob(filepath.Join(h.r.dir, "*")); len(files) != 0 {
		eventually(t, "retained event removed", func() bool { f, _ := filepath.Glob(filepath.Join(h.r.dir, "*")); return len(f) == 0 })
	}
	if len(h.rec.calls) != 1 || !strings.Contains(h.rec.calls[0], "host is starting") {
		t.Fatalf("issue comments = %q", h.rec.calls)
	}
}

func TestDuplicateAndConcurrentDelegationsDoNotDuplicateWork(t *testing.T) {
	h := newRelayHarness(t, t.TempDir())
	var wg sync.WaitGroup
	post := func(delivery, session, issue string) {
		defer wg.Done()
		h.post(t, delivery, sessionBody(t, "created", session, issue, nil))
	}
	wg.Add(6)
	go post("d1", "session-A", "issue-A")
	go post("d1", "session-A", "issue-A")  // same delivery redelivered
	go post("d1b", "session-A", "issue-A") // same session, new delivery id
	go post("d2", "session-B", "issue-B")  // simultaneous, different issue
	go post("d3", "session-C", "issue-C")
	go post("d3", "session-C", "issue-C")
	wg.Wait()
	eventually(t, "three deliveries", func() bool { return len(h.agent.sessions()) >= 3 })
	h.quiet(t)
	got := map[string]int{}
	for _, s := range h.agent.sessions() {
		got[s]++
	}
	if len(got) != 3 || got["session-A"] != 1 || got["session-B"] != 1 || got["session-C"] != 1 {
		t.Fatalf("delivered %v", got)
	}
	if h.gce.starts != 1 {
		t.Fatalf("VM started %d times", h.gce.starts)
	}
}

func TestDelegationIgnoresWhatIsNotWorkForTheAgent(t *testing.T) {
	h := newRelayHarness(t, "")
	ok := func(name string, body []byte, want int) {
		t.Helper()
		if code := h.post(t, "d-"+name, body); code != want {
			t.Fatalf("%s: status %d, want %d", name, code, want)
		}
	}
	ok("assigned-to-person", issueWebhookBody(t, infraTodoStatusID, true), 200) // an Issue event, as when an assignee changes
	ok("other-app", sessionBody(t, "created", "s", "i", func(m map[string]any) { m["appUserId"] = "someone-else" }), 200)
	ok("finished", sessionBody(t, "created", "s", "i", func(m map[string]any) { m["agentSession"].(map[string]any)["status"] = "complete" }), 200)
	ok("other-action", sessionBody(t, "removed", "s", "i", nil), 200)
	ok("stale", sessionBody(t, "created", "s", "i", func(m map[string]any) { m["webhookTimestamp"] = time.Now().Add(-2 * time.Minute).UnixMilli() }), 401)

	rr := httptest.NewRecorder()
	h.h.ServeHTTP(rr, signedDelegation(t, "wrong-secret", "d-bad", sessionBody(t, "created", "s", "i", nil)))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status %d", rr.Code)
	}
	h.quiet(t)
	if h.gce.starts != 0 || len(h.agent.sessions()) != 0 || len(h.rec.calls) != 0 {
		t.Fatalf("work started: starts=%d delivered=%v comments=%q", h.gce.starts, h.agent.sessions(), h.rec.calls)
	}
}

func TestSupersededAndWithdrawnDelegationsAreDropped(t *testing.T) {
	h := newRelayHarness(t, t.TempDir())
	// Hold the host back so both sessions are retained before either delivers.
	var open atomic.Bool
	real := h.r.wake
	h.r.wake = func(ctx context.Context) (wakeOut, error) {
		if !open.Load() {
			return wakeOut{Phase: "vm-starting"}, nil
		}
		return real(ctx)
	}
	h.post(t, "d1", sessionBody(t, "created", "session-old", "issue-A", nil))
	h.post(t, "d2", sessionBody(t, "created", "session-new", "issue-A", nil))
	h.post(t, "d3", sessionBody(t, "created", "session-withdrawn", "issue-W", nil))
	h.delegate.Store("a-person") // the issue was re-delegated before the agent was up... for all issues
	open.Store(true)
	h.quiet(t)
	if got := h.agent.sessions(); len(got) != 0 {
		t.Fatalf("delivered %v; the issues are no longer delegated to the agent", got)
	}
	eventually(t, "retained events cleared", func() bool { f, _ := filepath.Glob(filepath.Join(h.r.dir, "*")); return len(f) == 0 })
}

func TestOnlyNewestSessionOfAnIssueIsDelivered(t *testing.T) {
	h := newRelayHarness(t, "")
	var open atomic.Bool
	real := h.r.wake
	h.r.wake = func(ctx context.Context) (wakeOut, error) {
		if !open.Load() {
			return wakeOut{Phase: "vm-starting"}, nil
		}
		return real(ctx)
	}
	h.post(t, "d1", sessionBody(t, "created", "session-old", "issue-A", nil))
	h.post(t, "d2", sessionBody(t, "created", "session-new", "issue-A", nil))
	open.Store(true)
	eventually(t, "delivery", func() bool { return len(h.agent.sessions()) >= 1 })
	h.quiet(t)
	if got := h.agent.sessions(); len(got) != 1 || got[0] != "session-new" {
		t.Fatalf("delivered %v", got)
	}
}

// The toolbox restarting while the VM is still booting loses nothing.
func TestRetainedDelegationSurvivesToolboxRestart(t *testing.T) {
	dir := t.TempDir()
	first := newRelayHarness(t, dir)
	first.r.run = func(context.Context, delegation) {} // the process dies before it delivers
	first.post(t, "d1", sessionBody(t, "created", "session-A", "issue-A", nil))
	if f, _ := filepath.Glob(filepath.Join(dir, "*.json")); len(f) != 1 {
		t.Fatalf("retained files %v", f)
	}

	second := newRelayHarness(t, dir)
	if n := second.r.resume(); n != 1 {
		t.Fatalf("resumed %d", n)
	}
	eventually(t, "delivery after restart", func() bool { return len(second.agent.sessions()) == 1 })
	if second.agent.sessions()[0] != "session-A" {
		t.Fatalf("delivered %v", second.agent.sessions())
	}
	// A redelivery from Linear after the restart is still a duplicate.
	second.post(t, "d1", sessionBody(t, "created", "session-A", "issue-A", nil))
	second.quiet(t)
	if len(second.agent.sessions()) != 1 {
		t.Fatalf("duplicate after restart: %v", second.agent.sessions())
	}
}

func TestStartupFailureIsReportedOnTheIssue(t *testing.T) {
	dir := t.TempDir()
	h := newRelayHarness(t, dir)
	h.r.wake = func(context.Context) (wakeOut, error) {
		return wakeOut{Phase: "agent-failed", Detail: "the agent's start job exited 1"}, nil
	}
	h.post(t, "d1", sessionBody(t, "created", "session-A", "issue-A", nil))
	eventually(t, "failure comment", func() bool { h.rec.mu.Lock(); defer h.rec.mu.Unlock(); return len(h.rec.calls) == 1 })
	c := h.rec.calls[0]
	if !strings.Contains(c, "could not take this delegation") || !strings.Contains(c, "start job exited 1") || !strings.Contains(c, "Delegate the issue to the agent again") {
		t.Fatalf("comment = %q", c)
	}
	if _, err := os.Stat(filepath.Join(dir, "d1.failed")); err != nil {
		t.Fatalf("failed event not kept: %v", err)
	}
	if len(h.agent.sessions()) != 0 {
		t.Fatal("delivered despite failure")
	}
}

func TestDeliveryFailureIsReportedOnTheIssue(t *testing.T) {
	h := newRelayHarness(t, "")
	h.agent.code = http.StatusInternalServerError
	h.r.timeout = 300 * time.Millisecond
	h.post(t, "d1", sessionBody(t, "created", "session-A", "issue-A", nil))
	eventually(t, "failure comment", func() bool { h.rec.mu.Lock(); defer h.rec.mu.Unlock(); return len(h.rec.calls) >= 2 })
	last := h.rec.calls[len(h.rec.calls)-1]
	if !strings.Contains(last, "did not become ready") || !strings.Contains(last, "500") {
		t.Fatalf("comment = %q", last)
	}
}

// The Infrastructure Todo route and the delegation route are independent.
func TestTodoRerunStillWorksBesideTheRelay(t *testing.T) {
	t.Setenv("LINEAR_CHECK_WEBHOOK_SECRET", "check-secret")
	t.Setenv("LINEAR_AGENT_WEBHOOK_SECRET", "hook-secret")
	t.Setenv("LINEAR_API_KEY", "lin")
	t.Setenv("LINEAR_AGENT_APP_USER_ID", appUser)
	t.Setenv("LINEAR_AGENT_WEBHOOK_URL", "http://127.0.0.1:1/unused")
	tb, _, _ := newTestToolbox("RUNNING")
	srv := httptest.NewServer(newMux("", "http://example.test", tb))
	defer srv.Close()
	for path, secret := range map[string]string{"/linear/webhook": "check-secret", "/linear/agent-webhook": "hook-secret"} {
		req := signedRerunRequest(t, secret, "x", []byte(`{"type":"Issue","webhookTimestamp":`+itoa(time.Now().UnixMilli())+`}`))
		req.RequestURI, req.URL.Path = "", path
		hreq, _ := http.NewRequest(http.MethodPost, srv.URL+path, req.Body)
		hreq.Header = req.Header
		resp, err := http.DefaultClient.Do(hreq)
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("%s: %v %v", path, err, resp)
		}
		resp.Body.Close()
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }
