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
			"stateId":     stateID,
		},
		"updatedFrom":     updated,
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
