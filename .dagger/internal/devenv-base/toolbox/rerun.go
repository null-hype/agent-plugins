package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	infraTeamID       = "3b8f729e-b2fd-4b8d-8b24-5ef2df70e504"
	infraTodoStatusID = "92aa240b-7b53-4fde-8812-eea4f1243d10"
	infraDoneStatusID = "dc303bdd-20c6-4214-8b6f-73cbf43d03df"
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

type rerunController struct {
	tb   *toolbox
	mu   sync.Mutex
	seen map[string]struct{}
	run  func(context.Context, rerunRequest) error
}

func newRerunController(tb *toolbox) *rerunController {
	c := &rerunController{tb: tb, seen: map[string]struct{}{}}
	c.run = tb.runCheckRerun
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
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
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

// ExecScript runs a caller-supplied script over the same pinned SSH channel as
// host.sh. It is deliberately not exposed as an MCP tool: only the rerun
// controller uses it to submit one fixed, versioned job script.
func (h *sshHost) ExecScript(ctx context.Context, env map[string]string, script string, args ...string) ([]byte, error) {
	in, err := h.gce.Instance(ctx)
	if err != nil {
		return nil, err
	}
	if in.Status != "RUNNING" || in.IP == "" {
		return nil, fmt.Errorf("the host is %s", in.Status)
	}
	keys, err := h.gce.HostKeys(ctx)
	if err != nil || len(keys) == 0 {
		return nil, fmt.Errorf("the host has not published its SSH host keys yet: %v", err)
	}
	cfg := &ssh.ClientConfig{
		User:            h.user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(h.signer)},
		HostKeyCallback: pinnedHostKeys(keys),
		Timeout:         15 * time.Second,
	}
	addr := net.JoinHostPort(in.IP, "22")
	conn, err := (&net.Dialer{Timeout: cfg.Timeout}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		conn.Close()
		return nil, err
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return nil, err
	}
	defer sess.Close()
	var stdout, stderr bytes.Buffer
	sess.Stdin = strings.NewReader(exports(env) + script)
	sess.Stdout, sess.Stderr = &stdout, &stderr
	cmd := hostCommand(args)
	if err := sess.Run(cmd); err != nil {
		return nil, fmt.Errorf("rerun submit: %v: %s", err, lastLines(stderr.String(), 20))
	}
	return stdout.Bytes(), nil
}

func (t *toolbox) runCheckRerun(ctx context.Context, req rerunRequest) error {
	for {
		in, err := t.gce.Instance(ctx)
		if err != nil {
			return err
		}
		switch in.Status {
		case "RUNNING":
		case "TERMINATED", "STOPPED", "SUSPENDED":
			if err := t.gce.Start(ctx); err != nil {
				return err
			}
		default:
		}
		if in.Status == "RUNNING" {
			hs, err := t.hostStatus(ctx)
			if err == nil && hs.Ready {
				break
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Second):
		}
	}
	h, ok := t.host.(*sshHost)
	if !ok {
		return fmt.Errorf("rerun requires the SSH host implementation")
	}
	_, err := h.ExecScript(ctx, map[string]string{
		"PROTON_PASS_PERSONAL_ACCESS_TOKEN": t.passToken,
	}, rerunHostScript, req.Delivery, req.IssueID, req.Identifier, req.Repo, req.Ref, req.Check)
	return err
}

const rerunHostScript = `set -euo pipefail
JOBS=$HOME/.toolbox/jobs
mkdir -p "$JOBS"
delivery=$1 issue_id=$2 identifier=$3 repo=$4 ref=$5 check=$6
[[ $delivery =~ ^[A-Za-z0-9-]+$ ]] || { echo "invalid delivery" >&2; exit 2; }
[[ $identifier =~ ^[A-Z]+-[0-9]+$ ]] || { echo "invalid issue identifier" >&2; exit 2; }
[[ $repo = null-hype/worlds ]] || { echo "unsupported repo $repo" >&2; exit 2; }
[[ $ref =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "invalid ref" >&2; exit 2; }
[[ $check =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "invalid check" >&2; exit 2; }
id=rerun-$delivery
if [ -f "$JOBS/$id.exit" ] || { [ -f "$JOBS/$id.pid" ] && kill -0 "$(cat "$JOBS/$id.pid")" 2>/dev/null; }; then
  jq -n --arg id "$id" '{job: $id, duplicate: true}'
  exit 0
fi

run_rerun() {
  set -euo pipefail
  local delivery=$1 issue_id=$2 identifier=$3 repo=$4 ref=$5 check=$6 id=rerun-$1
  local root=$HOME/.toolbox/reruns/$delivery log=$JOBS/$id.dagger.log trace verdict comment gql_env dagger_exit complete
  mkdir -p "$root" "$HOME/.local/bin"
  export PATH="$HOME/.local/bin:$PATH"
  export PROTON_PASS_KEY_PROVIDER=fs
  export PROTON_PASS_AGENT_REASON="Linear check rerun $identifier: resolve check, Dagger Cloud and Linear credentials"
  if ! pass-cli info >/dev/null 2>&1; then
    pass-cli logout --force >/dev/null 2>&1 || true
    pass-cli login >/dev/null
  fi
  if [ "$(dagger version 2>/dev/null | awk '/version:/ {print $2}' | head -1)" != v0.21.8 ]; then
    curl -fsSL https://dl.dagger.io/dagger/install.sh | DAGGER_VERSION=0.21.8 BIN_DIR="$HOME/.local/bin" sh >/dev/null
  fi
  rm -rf "$root/repo"
  git clone -q --depth 1 --branch "$ref" "https://github.com/$repo.git" "$root/repo"
  cat > "$root/runtime.env" <<'ENV'
DAGGER_CLOUD_TOKEN=pass://infra/dagger.cloud/DAGGER_CLOUD_TOKEN
LINEAR_API_KEY=pass://api.linear.app/Citizen6.Librarian6.Refrain4/LINEAR_API_KEY
ENV
  cd "$root/repo"
  # Dagger reads function defaults from its .env, not the process environment.
  # Keep this live fixture apart from the already-approved manual run.
  echo "REGISTEREDDELIVERY_RUN=linear-inf-6" >> .env
  set +e
  pass-cli run --env-file .env --env-file "$root/runtime.env" -- dagger check "$check" >"$log" 2>&1
  dagger_exit=$?
  set -e
  trace=$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -Eo 'https://dagger\.cloud[^[:space:]]+' | tail -1 | sed 's/[),.;]*$//' || true)
  verdict=$(sed 's/\x1b\[[0-9;]*m//g' "$log" | sed -n -e 's/^.*| Verdict: /Verdict: /' -e 's/^Verdict: //p' | tail -1 || true)

  # A green check is complete. registered-delivery also deliberately exits 1
  # for a valid disagreement; its explicit valid-finding verdict is a result,
  # not a broken instrument. Everything else stays Todo for another look.
  complete=false
  if [ -n "$trace" ] && { [ "$dagger_exit" -eq 0 ] || [[ $verdict == "valid finding:"* ]]; }; then
    complete=true
  fi

  if [ "$complete" = true ]; then
    if [ -n "$verdict" ]; then
      comment="Rerun completed for $check: $verdict

Dagger trace: $trace

Linear delivery: $delivery"
    else
      comment="Rerun completed for $check (Dagger exit $dagger_exit).

Dagger trace: $trace

Linear delivery: $delivery"
    fi
  elif [ -n "$trace" ]; then
    comment="Rerun did not produce a completed result for $check (Dagger exit $dagger_exit). The issue remains Todo.

Dagger trace: $trace

Linear delivery: $delivery"
  else
    comment="Rerun did not produce a completed result or Dagger trace for $check (Dagger exit $dagger_exit). The issue remains Todo.

Linear delivery: $delivery"
  fi

  gql_env=$root/runtime.env
  jq -n --arg issue "$issue_id" --arg body "$comment" '{query:"mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",variables:{input:{issueId:$issue,body:$body}}}' |
    pass-cli run --env-file "$gql_env" -- sh -c 'curl -fsS https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: $LINEAR_API_KEY" --data @-' > "$root/comment.json"
  jq -e '.data.commentCreate.success == true' "$root/comment.json" >/dev/null

  if [ "$complete" = true ]; then
    jq -n --arg id "$issue_id" --arg state "` + infraDoneStatusID + `" '{query:"mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }",variables:{id:$id,input:{stateId:$state}}}' |
      pass-cli run --env-file "$gql_env" -- sh -c 'curl -fsS https://api.linear.app/graphql -H "Content-Type: application/json" -H "Authorization: $LINEAR_API_KEY" --data @-' > "$root/update.json"
    jq -e '.data.issueUpdate.success == true' "$root/update.json" >/dev/null
  fi
  jq -n --arg issue "$identifier" --arg check "$check" --arg trace "$trace" --arg verdict "$verdict" --argjson dagger_exit "$dagger_exit" --argjson complete "$complete" \
    '{issue:$issue,check:$check,trace:$trace,verdict:$verdict,dagger_exit:$dagger_exit,complete:$complete}' > "$JOBS/$id.json"
}
export JOBS
rm -f "$JOBS/$id.exit" "$JOBS/$id.interrupted" "$JOBS/$id.json"
setsid nohup bash -c "$(declare -f run_rerun)"'
  run_rerun "$@"; code=$?; echo "$code" > "'"$JOBS/$id.exit"'"' _ "$delivery" "$issue_id" "$identifier" "$repo" "$ref" "$check" \
  > "$JOBS/$id.log" 2>&1 < /dev/null &
echo $! > "$JOBS/$id.pid"
jq -n --arg id "$id" '{job: $id, duplicate: false, running: true}'
`
