package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Delegating an issue to the Linear agent makes Linear send an
// AgentSessionEvent (action "created") to the OAuth app's webhook URL, and it
// must be answered within 5 seconds; a "prompted" event follows each later
// message in the session. A failed delivery is retried only after 1 minute,
// 1 hour and 6 hours, which is no help to a VM that takes minutes to boot.
// So the app's webhook URL is this route: it verifies the event, answers 200,
// keeps the event, wakes the host with the same wake that host_wake uses
// (VM, host, agent, live webhook), and then hands the event to the agent's
// own webhook, restamped and re-signed because the agent rejects bodies older
// than a minute. The agent is unchanged.

type agentSessionEvent struct {
	Type             string `json:"type"`
	Action           string `json:"action"`
	AppUserID        string `json:"appUserId"`
	WebhookTimestamp int64  `json:"webhookTimestamp"`
	AgentSession     struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		IssueID   string `json:"issueId"`
		AppUserID string `json:"appUserId"`
		Issue     struct {
			ID string `json:"id"`
		} `json:"issue"`
	} `json:"agentSession"`
}

func (e agentSessionEvent) issueID() string {
	if e.AgentSession.IssueID != "" {
		return e.AgentSession.IssueID
	}
	return e.AgentSession.Issue.ID
}

// delegation is one retained event.
type delegation struct {
	Delivery string `json:"delivery"`
	Body     string `json:"body"`
	Session  string `json:"-"`
	Issue    string `json:"-"`
	Action   string `json:"-"`
}

type delegationRelay struct {
	tb          *toolbox
	linear      *linearAPI
	appUserID   string
	agentURL    string
	agentSecret string
	// dir keeps events until they are delivered, so a restart of the toolbox
	// does not lose them. Empty keeps them in memory only.
	dir     string
	client  *http.Client
	poll    time.Duration
	timeout time.Duration

	wakeMu  sync.Mutex
	wake    func(context.Context) (wakeOut, error)
	deliver func(context.Context, delegation) error
	// delegate reports who the issue is delegated to now.
	delegate func(context.Context, string) (string, error)
	run      func(context.Context, delegation)

	mu       sync.Mutex
	seen     map[string]struct{} // deliveries
	sessions map[string]struct{} // created sessions
	latest   map[string]string   // issue -> newest session
}

func newDelegationRelay(tb *toolbox, linear *linearAPI, appUserID, agentURL, agentSecret, dir string) *delegationRelay {
	r := &delegationRelay{
		tb: tb, linear: linear, appUserID: appUserID, agentURL: agentURL, agentSecret: agentSecret, dir: dir,
		client: &http.Client{Timeout: 30 * time.Second}, poll: 20 * time.Second, timeout: 30 * time.Minute,
		seen: map[string]struct{}{}, sessions: map[string]struct{}{}, latest: map[string]string{},
	}
	r.wake = tb.wake
	r.deliver = r.forward
	r.delegate = linear.delegateID
	r.run = r.process
	return r
}

func delegationHandler(secret string, r *delegationRelay) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(req.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		if !validLinearSignature(secret, req.Header.Get("Linear-Signature"), body) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		var ev agentSessionEvent
		if err := json.Unmarshal(body, &ev); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if ev.WebhookTimestamp == 0 || absDuration(time.Since(time.UnixMilli(ev.WebhookTimestamp))) > time.Minute {
			http.Error(w, "stale webhook", http.StatusUnauthorized)
			return
		}
		d, ok := r.relevant(ev, req.Header.Get("Linear-Delivery"), body)
		if ok {
			if err := r.accept(d); err != nil {
				// Not retained: let Linear's own retry bring it back.
				log.Printf("agent delegation %s (%s): not retained: %v", d.Issue, d.Delivery, err)
				http.Error(w, "not retained", http.StatusInternalServerError)
				return
			}
		}
		w.WriteHeader(http.StatusOK)
	})
}

// relevant says whether the event is work for this agent: a session event on
// this app user that is not already finished. Other events, such as an issue
// assigned to a person, never reach here as work.
func (r *delegationRelay) relevant(ev agentSessionEvent, delivery string, body []byte) (delegation, bool) {
	if delivery == "" || ev.Type != "AgentSessionEvent" || (ev.Action != "created" && ev.Action != "prompted") {
		return delegation{}, false
	}
	if r.appUserID == "" || ev.AppUserID != r.appUserID {
		return delegation{}, false
	}
	if terminalSession[ev.AgentSession.Status] || ev.AgentSession.ID == "" || ev.issueID() == "" {
		return delegation{}, false
	}
	return delegation{Delivery: delivery, Body: string(body), Session: ev.AgentSession.ID, Issue: ev.issueID(), Action: ev.Action}, true
}

var terminalSession = map[string]bool{"complete": true, "error": true}

// accept retains the event and starts its delivery, unless it is a duplicate.
func (r *delegationRelay) accept(d delegation) error {
	r.mu.Lock()
	if _, dup := r.seen[d.Delivery]; dup {
		r.mu.Unlock()
		return nil
	}
	if d.Action == "created" {
		if _, dup := r.sessions[d.Session]; dup {
			r.mu.Unlock()
			return nil
		}
	}
	if err := r.persist(d); err != nil {
		r.mu.Unlock()
		return err
	}
	r.seen[d.Delivery] = struct{}{}
	if d.Action == "created" {
		r.sessions[d.Session] = struct{}{}
		r.latest[d.Issue] = d.Session
	} else if _, known := r.latest[d.Issue]; !known {
		r.latest[d.Issue] = d.Session
	}
	r.mu.Unlock()
	go r.run(context.Background(), d)
	return nil
}

func (r *delegationRelay) file(d delegation, ext string) string {
	return filepath.Join(r.dir, strings.NewReplacer("/", "_", "..", "_").Replace(d.Delivery)+ext)
}

func (r *delegationRelay) persist(d delegation) error {
	if r.dir == "" {
		return nil
	}
	b, _ := json.Marshal(d)
	tmp := r.file(d, ".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.file(d, ".json"))
}

func (r *delegationRelay) settle(d delegation, ext string) {
	if r.dir == "" {
		return
	}
	if ext == "" {
		_ = os.Remove(r.file(d, ".json"))
		return
	}
	_ = os.Rename(r.file(d, ".json"), r.file(d, ext))
}

// resume takes up the events a previous process retained and had not
// delivered. Returns how many.
func (r *delegationRelay) resume() int {
	if r.dir == "" {
		return 0
	}
	files, _ := filepath.Glob(filepath.Join(r.dir, "*.json"))
	n := 0
	for _, f := range files {
		b, err := os.ReadFile(f)
		var d delegation
		var ev agentSessionEvent
		if err != nil || json.Unmarshal(b, &d) != nil || json.Unmarshal([]byte(d.Body), &ev) != nil {
			log.Printf("agent delegation: unreadable retained event %s", f)
			continue
		}
		d.Session, d.Issue, d.Action = ev.AgentSession.ID, ev.issueID(), ev.Action
		r.mu.Lock()
		r.seen[d.Delivery] = struct{}{}
		if d.Action == "created" {
			r.sessions[d.Session] = struct{}{}
			r.latest[d.Issue] = d.Session
		}
		r.mu.Unlock()
		n++
		go r.run(context.Background(), d)
	}
	return n
}

func (r *delegationRelay) superseded(d delegation) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.latest[d.Issue]
	return ok && cur != d.Session
}

// process wakes the host until the agent answers, then delivers. It ends in
// the agent holding the event, in the event being dropped because it is stale,
// or in a comment on the issue saying why it could not be delivered.
func (r *delegationRelay) process(ctx context.Context, d delegation) {
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	err := r.drive(ctx, d)
	if err == nil {
		return
	}
	log.Printf("agent delegation %s (%s): %v", d.Issue, d.Delivery, err)
	// The retained event is kept as <delivery>.failed for inspection.
	r.settle(d, ".failed")
	cctx, ccancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer ccancel()
	if cerr := r.linear.comment(cctx, d.Issue, fmt.Sprintf(
		"The Claude agent could not take this delegation: %v\n\nDelegate the issue to the agent again to retry.\n\nLinear delivery: %s", err, d.Delivery)); cerr != nil {
		log.Printf("agent delegation %s (%s): failure not reported: %v", d.Issue, d.Delivery, cerr)
	}
}

func (r *delegationRelay) drive(ctx context.Context, d delegation) error {
	announced := false
	var last error
	for {
		if r.superseded(d) {
			log.Printf("agent delegation %s (%s): superseded by a newer session; dropped", d.Issue, d.Delivery)
			r.settle(d, "")
			return nil
		}
		ready, err := r.wakeStep(ctx)
		if err != nil && ctx.Err() != nil {
			// The deadline cut this call short; keep the earlier, real cause.
			err = nil
		}
		switch {
		case errors.Is(err, errAgentFailed):
			return err
		case err != nil:
			last = err
		case ready:
			done, err := r.handOff(ctx, d)
			if err != nil {
				if ctx.Err() == nil {
					last = err
				}
			} else {
				if done {
					r.settle(d, "")
				}
				return nil
			}
		case !announced:
			announced = true
			if cerr := r.linear.comment(ctx, d.Issue, "The Claude agent's host is starting. This delegation is retained and will be delivered when the agent answers."); cerr != nil {
				log.Printf("agent delegation %s: start not reported: %v", d.Issue, cerr)
			}
		}
		if err := sleep(ctx, r.poll); err != nil {
			if last != nil {
				err = fmt.Errorf("%w (last error: %v)", err, last)
			}
			return fmt.Errorf("the agent did not become ready in %s: %w", r.timeout, err)
		}
	}
}

var errAgentFailed = errors.New("the agent failed to start")

// wakeStep is one host_wake. Starts are serialised so simultaneous
// delegations do not start the host twice.
func (r *delegationRelay) wakeStep(ctx context.Context) (bool, error) {
	r.wakeMu.Lock()
	defer r.wakeMu.Unlock()
	w, err := r.wake(ctx)
	if err != nil {
		return false, err
	}
	if w.Phase == "agent-failed" {
		return false, fmt.Errorf("%w: %s", errAgentFailed, w.Detail)
	}
	return w.Ready, nil
}

// handOff delivers if the issue is still delegated to the agent. done is
// false when the delegation was withdrawn and the event dropped.
func (r *delegationRelay) handOff(ctx context.Context, d delegation) (bool, error) {
	if d.Action == "created" {
		who, err := r.delegate(ctx, d.Issue)
		if err != nil {
			return false, err
		}
		if who != r.appUserID {
			log.Printf("agent delegation %s (%s): no longer delegated to the agent; dropped", d.Issue, d.Delivery)
			r.settle(d, "")
			return false, nil
		}
	}
	if r.superseded(d) {
		log.Printf("agent delegation %s (%s): superseded by a newer session; dropped", d.Issue, d.Delivery)
		r.settle(d, "")
		return false, nil
	}
	return true, r.deliver(ctx, d)
}

// forward posts the event to the agent's webhook, restamped and re-signed.
func (r *delegationRelay) forward(ctx context.Context, d delegation) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal([]byte(d.Body), &m); err != nil {
		return err
	}
	m["webhookTimestamp"] = json.RawMessage(fmt.Sprint(time.Now().UnixMilli()))
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, []byte(r.agentSecret))
	_, _ = mac.Write(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.agentURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Linear-Delivery", d.Delivery)
	req.Header.Set("Linear-Event", "AgentSessionEvent")
	req.Header.Set("Linear-Signature", hex.EncodeToString(mac.Sum(nil)))
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("agent webhook: %w", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("agent webhook: %s: %s", resp.Status, lastLines(string(b), 3))
	}
	return nil
}
