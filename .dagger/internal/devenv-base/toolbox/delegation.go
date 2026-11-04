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
		CreatedAt string `json:"createdAt"`
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

// created is when Linear created the session, from the signed payload; it,
// not arrival order, says which of an issue's sessions is newest. A payload
// without it falls back to Linear's own webhook timestamp.
func (e agentSessionEvent) created() int64 {
	if t, err := time.Parse(time.RFC3339Nano, e.AgentSession.CreatedAt); err == nil {
		return t.UnixMilli()
	}
	return e.WebhookTimestamp
}

// What Linear said the issue's delegate was when the event arrived. A mention
// creates a session too, and is not withdrawn by changing the delegate, so
// only "agent" is re-checked as a withdrawal; "unknown" means Linear could not
// be asked, which is not the same as a mention.
const (
	delegateAgent   = "agent"
	delegateOther   = "other"
	delegateUnknown = "unknown"
)

// delegation is one retained event.
type delegation struct {
	Delivery string `json:"delivery"`
	Body     string `json:"body"`
	Delegate string `json:"delegate"`
	Session  string `json:"-"`
	Issue    string `json:"-"`
	Action   string `json:"-"`
	Created  int64  `json:"-"`
}

func (d *delegation) parse() error {
	var ev agentSessionEvent
	if err := json.Unmarshal([]byte(d.Body), &ev); err != nil {
		return err
	}
	d.Session, d.Issue, d.Action, d.Created = ev.AgentSession.ID, ev.issueID(), ev.Action, ev.created()
	return nil
}

type sessionRef struct {
	id      string
	created int64
}

// newerThan orders sessions by Linear's creation time, then by id so that
// ties resolve the same way on every run and after a restart.
func (a sessionRef) newerThan(b sessionRef) bool {
	return a.created > b.created || (a.created == b.created && a.id > b.id)
}

type delegationRelay struct {
	tb          *toolbox
	linear      *linearAPI
	appUserID   string
	agentURL    string
	agentSecret string
	// dir keeps events until they are delivered, so a restart of the toolbox
	// does not lose them, and keeps a record of each settled one so a
	// redelivery after a restart is still a duplicate. Required.
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
	seen     map[string]struct{}   // deliveries
	sessions map[string]struct{}   // created sessions
	latest   map[string]sessionRef // issue -> newest session
}

func newDelegationRelay(tb *toolbox, linear *linearAPI, appUserID, agentURL, agentSecret, dir string) *delegationRelay {
	r := &delegationRelay{
		tb: tb, linear: linear, appUserID: appUserID, agentURL: agentURL, agentSecret: agentSecret, dir: dir,
		client: &http.Client{Timeout: 30 * time.Second}, poll: 20 * time.Second, timeout: 30 * time.Minute,
		seen: map[string]struct{}{}, sessions: map[string]struct{}{}, latest: map[string]sessionRef{},
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
		if ev.Type == "Issue" {
			// The app's webhook also carries what the agent reacts to while it
			// runs. Waking the host for it would be pointless: the agent follows
			// an edited description only for a session it holds in memory, which
			// a stopped VM does not have. So it is passed on if the host is up.
			// Stale bodies are not passed on.
			if ev.WebhookTimestamp != 0 && absDuration(time.Since(time.UnixMilli(ev.WebhookTimestamp))) <= time.Minute {
				r.passOn(body, req.Header.Get("Linear-Delivery"))
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		if ev.WebhookTimestamp == 0 || absDuration(time.Since(time.UnixMilli(ev.WebhookTimestamp))) > time.Minute {
			http.Error(w, "stale webhook", http.StatusUnauthorized)
			return
		}
		d, ok := r.relevant(ev, req.Header.Get("Linear-Delivery"), body)
		if ok {
			// Whether this is a delegation or, say, a mention is read from Linear
			// now. If Linear does not answer it stays unknown and is settled at
			// delivery, never assumed to be a mention.
			qctx, cancel := context.WithTimeout(req.Context(), 3*time.Second)
			who, err := r.delegate(qctx, d.Issue)
			cancel()
			switch {
			case err != nil:
				d.Delegate = delegateUnknown
				log.Printf("agent delegation %s (%s): delegate not read on arrival: %v", d.Issue, d.Delivery, err)
			case who == r.appUserID:
				d.Delegate = delegateAgent
			default:
				d.Delegate = delegateOther
			}
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
	return delegation{Delivery: delivery, Body: string(body), Session: ev.AgentSession.ID, Issue: ev.issueID(), Action: ev.Action, Created: ev.created()}, true
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
	r.note(d)
	r.mu.Unlock()
	go r.run(context.Background(), d)
	return nil
}

// note records the event's session; r.mu is held.
func (r *delegationRelay) note(d delegation) {
	r.seen[d.Delivery] = struct{}{}
	if d.Action == "created" {
		r.sessions[d.Session] = struct{}{}
	}
	ref := sessionRef{d.Session, d.Created}
	if cur, ok := r.latest[d.Issue]; !ok || ref.newerThan(cur) {
		r.latest[d.Issue] = ref
	}
}

// A retained event is <sha256 of delivery id>.json; once settled it stays as
// .done (delivered, or dropped as stale) or .failed, so that it still counts
// as seen after a restart. Settled records are pruned after a week.
func (r *delegationRelay) file(d delegation, ext string) string {
	sum := sha256.Sum256([]byte(d.Delivery))
	return filepath.Join(r.dir, hex.EncodeToString(sum[:])+ext)
}

func (r *delegationRelay) persist(d delegation) error {
	if r.dir == "" {
		return errors.New("no relay directory configured")
	}
	b, _ := json.Marshal(d)
	tmp := r.file(d, ".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.file(d, ".json"))
}

func (r *delegationRelay) settle(d delegation, ext string) {
	if err := os.Rename(r.file(d, ".json"), r.file(d, ext)); err != nil {
		log.Printf("agent delegation %s (%s): could not record %s: %v", d.Issue, d.Delivery, ext, err)
	}
}

// resume reloads what the previous process knew: every record marks its
// delivery and session as seen and orders the issue's sessions, and the ones
// not settled are taken up again. Returns how many were.
func (r *delegationRelay) resume() int {
	var pending []delegation
	for _, ext := range []string{".json", ".done", ".failed"} {
		files, _ := filepath.Glob(filepath.Join(r.dir, "*"+ext))
		for _, f := range files {
			if ext != ".json" {
				if fi, err := os.Stat(f); err == nil && time.Since(fi.ModTime()) > 7*24*time.Hour {
					_ = os.Remove(f)
					continue
				}
			}
			b, err := os.ReadFile(f)
			var d delegation
			if err != nil || json.Unmarshal(b, &d) != nil || d.parse() != nil {
				log.Printf("agent delegation: unreadable record %s", f)
				continue
			}
			r.mu.Lock()
			r.note(d)
			r.mu.Unlock()
			if ext == ".json" {
				pending = append(pending, d)
			}
		}
	}
	// Start only after every record has been read, so the order of the
	// issue's sessions is known first.
	for _, d := range pending {
		go r.run(context.Background(), d)
	}
	return len(pending)
}

// superseded: a newer session of the same issue exists.
func (r *delegationRelay) superseded(d delegation) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.latest[d.Issue]
	return ok && cur.id != d.Session && cur.newerThan(sessionRef{d.Session, d.Created})
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
			r.settle(d, ".done")
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
			if errors.Is(err, errDelegationUnconfirmed) {
				return err
			}
			if err != nil {
				if ctx.Err() == nil {
					last = err
				}
			} else {
				if done {
					r.settle(d, ".done")
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

var errDelegationUnconfirmed = errors.New("Linear could not confirm on arrival that the issue was delegated to the agent, and it is not delegated to it now, so this may be a withdrawn delegation; not started (to run it, delegate the issue again or mention the agent again)")

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

// handOff delivers if the event is still wanted: no newer session of the
// issue exists, and an issue that was delegated to the agent still is. This
// holds for prompted events as much as created ones. done is false when the
// event was dropped.
func (r *delegationRelay) handOff(ctx context.Context, d delegation) (bool, error) {
	if d.Delegate == delegateAgent || d.Delegate == delegateUnknown {
		who, err := r.delegate(ctx, d.Issue)
		if err != nil {
			return false, err // not read: try again, never deliver on a guess
		}
		if who != r.appUserID {
			if d.Delegate == delegateUnknown {
				// A mention or a withdrawn delegation: Linear cannot now say which.
				return false, errDelegationUnconfirmed
			}
			log.Printf("agent delegation %s (%s): no longer delegated to the agent; dropped", d.Issue, d.Delivery)
			r.settle(d, ".done")
			return false, nil
		}
	}
	if r.superseded(d) {
		log.Printf("agent delegation %s (%s): superseded by a newer session; dropped", d.Issue, d.Delivery)
		r.settle(d, ".done")
		return false, nil
	}
	// A delivery whose answer is lost may be sent again; the agent claims each
	// event once, so the repeat does not start a second run.
	return true, r.deliver(ctx, d)
}

// passOn sends an Issue event to the agent if the host is already running.
func (r *delegationRelay) passOn(body []byte, delivery string) {
	if delivery == "" {
		return
	}
	r.mu.Lock()
	_, dup := r.seen["issue:"+delivery]
	r.seen["issue:"+delivery] = struct{}{}
	r.mu.Unlock()
	if dup {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if in, err := r.tb.gce.Instance(ctx); err != nil || in.Status != "RUNNING" {
			return
		}
		if err := r.post(ctx, body, delivery, "Issue"); err != nil {
			log.Printf("agent issue event (%s): %v", delivery, err)
		}
	}()
}

// forward posts the event to the agent's webhook, restamped and re-signed.
func (r *delegationRelay) forward(ctx context.Context, d delegation) error {
	return r.post(ctx, []byte(d.Body), d.Delivery, "AgentSessionEvent")
}

func (r *delegationRelay) post(ctx context.Context, original []byte, delivery, event string) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(original, &m); err != nil {
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
	req.Header.Set("Linear-Delivery", delivery)
	req.Header.Set("Linear-Event", event)
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
