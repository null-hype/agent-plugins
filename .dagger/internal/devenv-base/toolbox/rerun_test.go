package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const infra6Description = "## Semantic identity\n\nThis issue and `null-hype/worlds` → `RegisteredDelivery` / `dagger check registered-delivery` represent the same verification goal."

func signedRerunRequest(t *testing.T, secret, delivery string, body []byte) *http.Request {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	req := httptest.NewRequest(http.MethodPost, "/linear/webhook", bytes.NewReader(body))
	req.Header.Set("Linear-Signature", hex.EncodeToString(mac.Sum(nil)))
	req.Header.Set("Linear-Delivery", delivery)
	return req
}

func issueWebhookBody(t *testing.T, stateID string, changed bool) []byte {
	t.Helper()
	updated := map[string]any{}
	if changed {
		updated["stateId"] = "old-state"
	}
	body, err := json.Marshal(map[string]any{
		"action": "update",
		"type":   "Issue",
		"data": map[string]any{
			"id":          "57805248-b4bd-4415-8cf8-62981c01dae2",
			"identifier":  "INF-6",
			"description": infra6Description,
			"teamId":      infraTeamID,
			"stateId":     stateID,
		},
		"updatedFrom":      updated,
		"webhookTimestamp": time.Now().UnixMilli(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestRerunFromIssueEvent(t *testing.T) {
	var event linearIssueWebhook
	if err := json.Unmarshal(issueWebhookBody(t, infraTodoStatusID, true), &event); err != nil {
		t.Fatal(err)
	}
	got, ok := rerunFromIssueEvent(event, "delivery-1")
	if !ok {
		t.Fatal("Todo transition was not accepted")
	}
	if got.Identifier != "INF-6" || got.Repo != "null-hype/worlds" || got.Check != "registered-delivery" || got.Ref != "main" {
		t.Fatalf("rerun = %+v", got)
	}

	event = linearIssueWebhook{}
	if err := json.Unmarshal(issueWebhookBody(t, "some-other-state", true), &event); err != nil {
		t.Fatal(err)
	}
	if _, ok := rerunFromIssueEvent(event, "delivery-2"); ok {
		t.Fatal("non-Todo transition was accepted")
	}

	event = linearIssueWebhook{}
	if err := json.Unmarshal(issueWebhookBody(t, infraTodoStatusID, false), &event); err != nil {
		t.Fatal(err)
	}
	if _, ok := rerunFromIssueEvent(event, "delivery-3"); ok {
		t.Fatal("Todo issue without a state transition was accepted")
	}

	event = linearIssueWebhook{}
	if err := json.Unmarshal(issueWebhookBody(t, infraTodoStatusID, true), &event); err != nil {
		t.Fatal(err)
	}
	event.Data.TeamID = "another-team"
	if _, ok := rerunFromIssueEvent(event, "delivery-4"); ok {
		t.Fatal("Todo transition outside the Infrastructure team was accepted")
	}
}

func TestLinearRerunWebhookVerifiesAndDeduplicates(t *testing.T) {
	secret := "test-secret"
	got := make(chan rerunRequest, 2)
	c := &rerunController{seen: map[string]struct{}{}, run: func(_ context.Context, req rerunRequest) error {
		got <- req
		return nil
	}}
	h := linearRerunHandler(secret, c)
	body := issueWebhookBody(t, infraTodoStatusID, true)

	for i := 0; i < 2; i++ {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, signedRerunRequest(t, secret, "same-delivery", body))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d", rr.Code)
		}
	}
	select {
	case req := <-got:
		if req.Identifier != "INF-6" || req.Check != "registered-delivery" {
			t.Fatalf("request = %+v", req)
		}
	case <-time.After(time.Second):
		t.Fatal("rerun was not enqueued")
	}
	select {
	case req := <-got:
		t.Fatalf("duplicate rerun was enqueued: %+v", req)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestLinearRerunWebhookRejectsBadSignatureAndStaleBody(t *testing.T) {
	secret := "test-secret"
	c := &rerunController{seen: map[string]struct{}{}, run: func(context.Context, rerunRequest) error { return nil }}
	h := linearRerunHandler(secret, c)
	body := issueWebhookBody(t, infraTodoStatusID, true)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/linear/webhook", bytes.NewReader(body))
	req.Header.Set("Linear-Signature", "00")
	req.Header.Set("Linear-Delivery", "delivery-bad")
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature status = %d", rr.Code)
	}

	var stale map[string]any
	if err := json.Unmarshal(body, &stale); err != nil {
		t.Fatal(err)
	}
	stale["webhookTimestamp"] = time.Now().Add(-2 * time.Minute).UnixMilli()
	staleBody, _ := json.Marshal(stale)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, signedRerunRequest(t, secret, "delivery-stale", staleBody))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("stale webhook status = %d", rr.Code)
	}
}

// linearRecorder is Linear's GraphQL endpoint as the controller sees it: it
// records each mutation and answers it with success.
type linearRecorder struct {
	mu    sync.Mutex
	calls []string
	auth  []string
}

func (l *linearRecorder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.auth = append(l.auth, r.Header.Get("Authorization"))
	input, _ := req.Variables["input"].(map[string]any)
	switch {
	case strings.Contains(req.Query, "commentCreate"):
		l.calls = append(l.calls, "comment "+input["body"].(string))
		fmt.Fprint(w, `{"data":{"commentCreate":{"success":true}}}`)
	case strings.Contains(req.Query, "issueUpdate"):
		l.calls = append(l.calls, "state "+input["stateId"].(string))
		fmt.Fprint(w, `{"data":{"issueUpdate":{"success":true}}}`)
	default:
		http.Error(w, "unexpected query", http.StatusBadRequest)
	}
}

func rerunHarness(t *testing.T, status ...string) (*rerunController, *fakeHost, *linearRecorder) {
	t.Helper()
	tb, _, h := newTestToolbox("RUNNING")
	h.checkStatus = status
	rec := &linearRecorder{}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	c := newRerunController(tb, &linearAPI{client: srv.Client(), url: srv.URL, key: "lin_api_test"})
	c.poll = time.Millisecond
	return c, h, rec
}

var inf6Rerun = rerunRequest{
	Delivery: "delivery-1", IssueID: "issue-uuid", Identifier: "INF-6",
	Repo: "null-hype/worlds", Ref: "main", Check: "registered-delivery",
}

func TestCheckRerunGreenIsDone(t *testing.T) {
	c, h, rec := rerunHarness(t,
		`{"job_running": true, "job_exit": null, "result": null}`,
		`{"job_running": false, "job_exit": 0, "result": {"exit": 0, "trace": "https://dagger.cloud/t/abc"}}`)
	if err := c.rerun(context.Background(), inf6Rerun); err != nil {
		t.Fatal(err)
	}
	var submit *hostCall
	for i := range h.calls {
		if h.calls[i].args[0] == "check" {
			submit = &h.calls[i]
		}
	}
	if submit == nil {
		t.Fatalf("no check submitted: %v", h.actions())
	}
	if got := strings.Join(submit.args, " "); got != "check delivery-1 null-hype/worlds main registered-delivery linear-inf-6" {
		t.Fatalf("submitted %q", got)
	}
	if _, ok := submit.env["LINEAR_API_KEY"]; ok || submit.env["PROTON_PASS_PERSONAL_ACCESS_TOKEN"] != "pass-token" {
		t.Fatalf("host env = %v; want the Pass token and no Linear key", submit.env)
	}
	if len(rec.calls) != 3 || rec.calls[0] != "state "+infraInReviewStatusID ||
		!strings.HasPrefix(rec.calls[1], "comment Rerun of `registered-delivery` is green.") ||
		!strings.Contains(rec.calls[1], "https://dagger.cloud/t/abc") || rec.calls[2] != "state "+infraDoneStatusID {
		t.Fatalf("linear calls = %q", rec.calls)
	}
	if rec.auth[0] != "lin_api_test" {
		t.Fatalf("authorization = %q", rec.auth[0])
	}
}

// A red check is a verdict: it is recorded, and the issue stays In Review.
func TestCheckRerunRedStaysInReview(t *testing.T) {
	c, _, rec := rerunHarness(t,
		`{"job_running": false, "job_exit": 0, "result": {"exit": 1, "trace": "https://dagger.cloud/t/def"}, "log_tail": "Verdict: not valid, the protocol"}`)
	if err := c.rerun(context.Background(), inf6Rerun); err != nil {
		t.Fatal(err)
	}
	if len(rec.calls) != 2 || rec.calls[0] != "state "+infraInReviewStatusID ||
		!strings.Contains(rec.calls[1], "is red (exit 1)") || !strings.Contains(rec.calls[1], "Verdict: not valid, the protocol") {
		t.Fatalf("linear calls = %q", rec.calls)
	}
}

// A job that broke before the check gave a verdict is a broken instrument:
// the controller reports an error, not a red check.
func TestCheckRerunBrokenJobIsAnError(t *testing.T) {
	c, _, rec := rerunHarness(t,
		`{"job_running": false, "job_exit": 128, "result": null, "log_tail": "fatal: Remote branch main not found"}`)
	err := c.rerun(context.Background(), inf6Rerun)
	if err == nil || !strings.Contains(err.Error(), "exited 128") {
		t.Fatalf("err = %v", err)
	}
	if len(rec.calls) != 2 || !strings.Contains(rec.calls[1], "did not finish") || !strings.Contains(rec.calls[1], "Remote branch main not found") {
		t.Fatalf("linear calls = %q", rec.calls)
	}
}
