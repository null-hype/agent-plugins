package main

import (
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
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	infraTeamID           = "3b8f729e-b2fd-4b8d-8b24-5ef2df70e504"
	infraTodoStatusID     = "92aa240b-7b53-4fde-8812-eea4f1243d10"
	infraInReviewStatusID = "d5bcce0e-8bbf-4cf6-8d22-8747ae817dca"
	infraDoneStatusID     = "dc303bdd-20c6-4214-8b6f-73cbf43d03df"
)

var checkIdentityRE = regexp.MustCompile(`(?s)This issue and\s+` + "`?" + `([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)` + "`?" + `.*?dagger check\s+([a-z0-9][a-z0-9-]*)`)

type linearIssueWebhook struct {
	Action string `json:"action"`
	Type   string `json:"type"`
	Data   struct {
		ID          string `json:"id"`
		Identifier  string `json:"identifier"`
		Description string `json:"description"`
		TeamID      string `json:"teamId"`
		StateID     string `json:"stateId"`
		State       struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"state"`
	} `json:"data"`
	UpdatedFrom      map[string]json.RawMessage `json:"updatedFrom"`
	WebhookTimestamp int64                      `json:"webhookTimestamp"`
}

type rerunRequest struct {
	Delivery   string
	IssueID    string
	Identifier string
	Repo       string
	Ref        string
	Check      string
}

// rerunController runs an Infrastructure check issue's check when the issue
// moves to Todo, and records the verdict on the issue, by the issue's
// isomorphism: In Review while the evidence is missing or unclear (running,
// or a run that did not finish), Done when the check is green, and a failing
// check leaves it In Review with what it said. Moving it to Todo again reruns.
// A check's exit code is its verdict: a valid finding that refutes a claim is
// the check's to report as green or not, not the controller's to read.
type rerunController struct {
	tb     *toolbox
	linear *linearAPI
	mu     sync.Mutex
	seen   map[string]struct{}
	run    func(context.Context, rerunRequest) error
	// poll is how often the host and the check's job are looked at.
	poll time.Duration
}

func newRerunController(tb *toolbox, linear *linearAPI) *rerunController {
	c := &rerunController{tb: tb, linear: linear, seen: map[string]struct{}{}, poll: 30 * time.Second}
	c.run = c.rerun
	return c
}

func (c *rerunController) enqueue(req rerunRequest) bool {
	c.mu.Lock()
	if _, ok := c.seen[req.Delivery]; ok {
		c.mu.Unlock()
		return false
	}
	c.seen[req.Delivery] = struct{}{}
	c.mu.Unlock()

	go func() {
		// A delivery run asks Jules for work: give it as long as it takes.
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Hour)
		defer cancel()
		if err := c.run(ctx, req); err != nil {
			log.Printf("linear rerun %s (%s): %v", req.Identifier, req.Delivery, err)
		}
	}()
	return true
}

func linearRerunHandler(secret string, c *rerunController) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		if !validLinearSignature(secret, r.Header.Get("Linear-Signature"), body) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		var event linearIssueWebhook
		if err := json.Unmarshal(body, &event); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if event.WebhookTimestamp == 0 || absDuration(time.Since(time.UnixMilli(event.WebhookTimestamp))) > time.Minute {
			http.Error(w, "stale webhook", http.StatusUnauthorized)
			return
		}
		req, ok := rerunFromIssueEvent(event, r.Header.Get("Linear-Delivery"))
		if ok {
			c.enqueue(req)
		}
		w.WriteHeader(http.StatusOK)
	})
}

func validLinearSignature(secret, got string, body []byte) bool {
	if secret == "" || got == "" {
		return false
	}
	sig, err := hex.DecodeString(got)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal(sig, mac.Sum(nil))
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func rerunFromIssueEvent(event linearIssueWebhook, delivery string) (rerunRequest, bool) {
	if delivery == "" || event.Type != "Issue" || event.Action != "update" {
		return rerunRequest{}, false
	}
	// v0 is deliberately scoped to the Infrastructure team's check issues.
	// Other teams can have a Todo state with different completion semantics.
	if event.Data.TeamID != infraTeamID {
		return rerunRequest{}, false
	}
	if _, changed := event.UpdatedFrom["stateId"]; !changed {
		if _, changed = event.UpdatedFrom["state"]; !changed {
			return rerunRequest{}, false
		}
	}
	stateID := event.Data.StateID
	if stateID == "" {
		stateID = event.Data.State.ID
	}
	if event.Data.State.Name != "Todo" && stateID != infraTodoStatusID {
		return rerunRequest{}, false
	}
	m := checkIdentityRE.FindStringSubmatch(event.Data.Description)
	if len(m) != 3 || m[1] != "null-hype/worlds" {
		return rerunRequest{}, false
	}
	if event.Data.ID == "" || event.Data.Identifier == "" {
		return rerunRequest{}, false
	}
	return rerunRequest{
		Delivery:   delivery,
		IssueID:    event.Data.ID,
		Identifier: event.Data.Identifier,
		Repo:       m[1],
		Ref:        "main",
		Check:      m[2],
	}, true
}

// runKey keys a check's sessions by its issue, so one issue's reruns resume
// one session (a delivery's Jules plan, and the predictions registered for it).
func runKey(identifier string) string {
	return "linear-" + strings.ToLower(identifier)
}

type checkStatus struct {
	JobRunning bool `json:"job_running"`
	JobExit    *int `json:"job_exit"`
	Result     *struct {
		Exit  int    `json:"exit"`
		Trace string `json:"trace"`
	} `json:"result"`
	LogTail string `json:"log_tail"`
}

func (c *rerunController) rerun(ctx context.Context, req rerunRequest) error {
	if err := c.linear.setState(ctx, req.IssueID, infraInReviewStatusID); err != nil {
		return err
	}
	st, err := c.check(ctx, req)
	if err != nil {
		// The instrument broke: the issue stays In Review, and says why, even
		// when what broke was the time the run had.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		return errors.Join(err, c.linear.comment(ctx, req.IssueID, fmt.Sprintf(
			"Rerun of `%s` did not finish: %v\n\nIt stays In Review; move it to Todo to rerun.\n\nLinear delivery: %s",
			req.Check, err, req.Delivery)))
	}
	if err := c.linear.comment(ctx, req.IssueID, verdictComment(req, st)); err != nil {
		return err
	}
	if st.Result.Exit == 0 {
		return c.linear.setState(ctx, req.IssueID, infraDoneStatusID)
	}
	return nil
}

// check wakes the host, submits the check's job and waits for its result.
func (c *rerunController) check(ctx context.Context, req rerunRequest) (checkStatus, error) {
	if err := c.hostReady(ctx); err != nil {
		return checkStatus{}, err
	}
	env := map[string]string{"PROTON_PASS_PERSONAL_ACCESS_TOKEN": c.tb.passToken}
	if _, err := c.tb.host.Run(ctx, env, "check", req.Delivery, req.Repo, req.Ref, req.Check, runKey(req.Identifier)); err != nil {
		return checkStatus{}, err
	}
	for {
		b, err := c.tb.host.Run(ctx, nil, "check-status", req.Delivery)
		if err != nil {
			return checkStatus{}, err
		}
		var st checkStatus
		if err := json.Unmarshal(b, &st); err != nil {
			return checkStatus{}, fmt.Errorf("check-status: %w", err)
		}
		if st.JobExit != nil {
			if *st.JobExit != 0 || st.Result == nil {
				return st, fmt.Errorf("the job running the check exited %d before the check gave a verdict:\n\n```\n%s\n```", *st.JobExit, st.LogTail)
			}
			return st, nil
		}
		if !st.JobRunning {
			return st, fmt.Errorf("the job running the check is gone without an exit code (was the host stopped?)")
		}
		if err := sleep(ctx, c.poll); err != nil {
			return checkStatus{}, err
		}
	}
}

// hostReady starts the host if it is stopped and waits until host.sh answers.
func (c *rerunController) hostReady(ctx context.Context) error {
	for {
		in, err := c.tb.gce.Instance(ctx)
		if err != nil {
			return err
		}
		switch in.Status {
		case "TERMINATED", "STOPPED", "SUSPENDED":
			if err := c.tb.gce.Start(ctx); err != nil {
				return err
			}
		case "RUNNING":
			if hs, err := c.tb.hostStatus(ctx); err == nil && hs.Ready {
				return nil
			}
		}
		if err := sleep(ctx, c.poll); err != nil {
			return fmt.Errorf("the host did not become ready: %w", err)
		}
	}
}

func sleep(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

func verdictComment(req rerunRequest, st checkStatus) string {
	var b strings.Builder
	if st.Result.Exit == 0 {
		fmt.Fprintf(&b, "Rerun of `%s` is green.", req.Check)
	} else {
		fmt.Fprintf(&b, "Rerun of `%s` is red (exit %d). It stays In Review; move it to Todo to rerun.\n\n```\n%s\n```", req.Check, st.Result.Exit, st.LogTail)
	}
	if st.Result.Trace != "" {
		fmt.Fprintf(&b, "\n\nDagger trace: %s", st.Result.Trace)
	}
	fmt.Fprintf(&b, "\n\nLinear delivery: %s", req.Delivery)
	return b.String()
}
