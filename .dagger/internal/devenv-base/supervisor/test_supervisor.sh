#!/usr/bin/env bash
# Runs supervisor.sh against stubbed pass-cli, restic and claude. No network,
# no credentials, no model: this checks what a tick is supposed to guarantee.
#
#   1. There is one hourly service, `supervisor`, on `13 * * * *`.
#   2. An hourly run restores the session from the newest snapshot tagged
#      `supervisor`, builds the workflow from a clone, runs the plan task on
#      `render workflows dev`, continues the session with `claude --continue`
#      from /workspaces/agent-plugins, renders its changeset through the real
#      pkl/Changeset.pkl, dry-runs apply on the dev server, opens the PR and
#      sets it to merge itself once its checks are green -- then backs the
#      session up. It first applies what merged last time, on Render. No
#      session id and no zone is read anywhere.
#   3. The backup happens after a failing or timed-out claude too, so the next
#      run remembers the failure; and a missing snapshot, or one without a
#      session in the working directory, fails the run before claude starts.
#   4. A run without a changeset fails, as does one where claude itself
#      exits nonzero -- silence must not look like success.
#   5. The prompt puts the Duo editor first, ends with the changeset, and
#      carries no midnight, timezone or zone framing.
#   6. The run cannot change anything itself: the toolbox's read tools and
#      Linear's read tools are allowed, every tool that writes, starts, stops
#      or ships is disallowed by name, and the bearer tokens reach claude
#      through a 0600 file rather than through argv.
#   7. Every secret, the toolbox token included, is resolved by `pass-cli run`
#      from pass:// references; the Render service holds only the pass token.
#      With no pass session, or no pass token, nothing runs. No secret is on
#      an argv or left in a file once the run ends.
#   8. A one-off calibration (SUPERVISOR_MODE=calibrate) is the same pipeline
#      with a fresh, cheap session and no restic, and only proposes its PR.
#      A green one pushes changeset.pkl and changeset.json to its own branch
#      and opens one PR, and calls nothing that deploys; an unchanged
#      changeset pushes nothing. A changeset that does not render, a missing
#      changeset, a failed dry run, a missing plan or dev server: each opens
#      no PR.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_YAML=$DIR/../render.yaml
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BIN=$WORK/bin
mkdir -p "$BIN"

cat > "$BIN/pass-cli" <<'STUB'
#!/usr/bin/env bash
# info: report a live session, so the script never attempts a login -- unless
# PASS_STUB_SESSION=none, when there is no session and no login succeeds.
# run --env-file F -- cmd...: resolve each KEY=pass://vault/item/NAME line to
# "resolved-NAME" -- so the value shows which pass item it came from -- and
# run the command with them, as the real one does. The file is logged first,
# to show which references a tick asks for, and so is every argv.
echo "pass-cli $*" >> "$PASS_ARGV_LOG"
case "${1:-}" in
  info) [ "${PASS_STUB_SESSION:-live}" = live ] || exit 1 ;;
  login) [ "${PASS_STUB_SESSION:-live}" = live ] || { echo "login failed" >&2; exit 1; } ;;
  run)
    shift
    envfile=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --env-file) envfile=$2; shift 2 ;;
        --) shift; break ;;
        *) shift ;;
      esac
    done
    if [ -n "$envfile" ]; then
      cat "$envfile" >> "$PASS_ENVFILE_LOG"
      while IFS='=' read -r key ref; do
        case "$key" in '' | '#'*) continue ;; esac
        export "$key=resolved-${ref##*/}"
      done < "$envfile"
    fi
    exec "$@"
    ;;
  *) exit 0 ;;
esac
STUB

cat > "$BIN/restic" <<'STUB'
#!/usr/bin/env bash
# Log every call in order, with the arguments it saw, and behave as
# RESTIC_STUB_SNAPSHOTS asks. restore plants the transcript where Claude
# keeps it for the working directory the tick runs from.
echo "restic $1" >> "$CALLS"
echo "restic $* (cwd=$PWD)" >> "$RESTIC_LOG"
case "$1" in
  snapshots)
    if [ "${RESTIC_STUB_SNAPSHOTS:-hit}" = hit ]; then
      # The newest is deliberately neither first nor last.
      echo '[{"id":"old","time":"2026-10-18T00:00:00Z"},{"id":"snap-new","time":"2026-10-19T00:00:00Z"},{"id":"older","time":"2026-10-17T00:00:00Z"}]'
    else
      echo '[]'
    fi
    ;;
  restore)
    target=""
    prev=""
    for a in "$@"; do
      [ "$prev" = "--target" ] && target=$a
      prev=$a
    done
    project=-workspaces-agent-plugins
    [ "${RESTIC_STUB_RESTORE:-ok}" = ok ] || project=-somewhere-else
    mkdir -p "$target/.claude/projects/$project" "$target/.claude/backups"
    echo '{}' > "$target/.claude/projects/$project/6f51ed1a-8bcc-4450-9cd8-37a26fce897e.jsonl"
    echo '{"account":"stub"}' > "$target/.claude/backups/.claude.json.backup.1"
    # The last apply, as the previous run kept it: main's changeset, applied
    # by a run that went through, unless RESTIC_STUB_APPLY says otherwise,
    # or is `none`.
    state=${RESTIC_STUB_APPLY:-$SEED_HASH trn-good}
    [ "$state" = none ] || echo "$state" > "$target/.claude/supervisor-apply"
    ;;
  backup) [ "${RESTIC_STUB_BACKUP:-ok}" = ok ] || exit 1 ;;
esac
STUB

cat > "$BIN/claude" <<'STUB'
#!/usr/bin/env bash
# Record argv (one argument per line), the directory it ran in and the MCP
# config handed over, then behave as CLAUDE_STUB_MODE asks.
echo "claude" >> "$CALLS"
printf '%s\n' "$@" > "$CLAUDE_ARGV"
echo "$PWD" > "$CLAUDE_PWD"
cfg="" prev=""
for a in "$@"; do
  [ "$prev" = "--mcp-config" ] && cfg=$a
  prev=$a
done
if [ -n "$cfg" ]; then
  cp "$cfg" "$CLAUDE_MCP"
  stat -c %a "$cfg" > "$CLAUDE_MCP_MODE"
fi
case "${CLAUDE_STUB_MODE:-ok}" in
  prose) echo "I had a look around and it all seems fine." ;;
  plan | plan-ship | badpkl | badpkl-once)
    hat=infra
    # badpkl-once: only the first planning run writes a bad changeset.
    case "$CLAUDE_STUB_MODE" in
      badpkl) hat=planning ;;
      badpkl-once) [ "$(grep -c '^claude$' "$CALLS")" -gt 1 ] || hat=planning ;;
    esac
    echo "Two findings on the supervisor belong together; one issue serves nothing."
    echo "SUPERVISOR_CHANGESET:"
    echo '```pkl'
    echo 'clusters {'
    echo '  new {'
    echo '    key = "new:review-findings"'
    echo '    title = "Review findings on the supervisor"'
    echo "    hat = \"$hat\""
    echo '    model = "sonnet"'
    echo '    effort = "medium"'
    echo '    serves = "CIT-439"'
    echo '    issues { "CIT-500"; "CIT-501" }'
    echo '  }'
    echo '}'
    echo 'decline { new { issue = "CIT-502"; reason = "nothing published depends on it" } }'
    echo 'delegate { new { issue = "new:review-findings"; agent = "tidelands-agent" } }'
    # plan-ship: also ship an issue no cluster names.
    if [ "$CLAUDE_STUB_MODE" = plan-ship ]; then
      echo 'ship { new { issue = "CIT-777"; env = "amazed-bluebird" } }'

    fi
    echo '```'
    ;;
  fail) echo "boom" >&2; exit 3 ;;
  hang) exec sleep 60 ;;
esac
STUB

# The calibration's tools. render stays up as the dev server until it is
# killed, and records its pid so the run can be checked for killing it.
cat > "$BIN/render" <<'STUB'
#!/usr/bin/env bash
echo "render" >> "$CALLS"
echo "render $* (cwd=$PWD)" >> "$RENDER_LOG"
echo $$ > "$RENDER_PID"
exec sleep 30
STUB

cat > "$BIN/curl" <<'STUB'
#!/usr/bin/env bash
# Only the dev server's readiness probe uses curl. Like the real probe, it
# answers only once the dev server has started, which also keeps "render"
# ahead of "node" in $CALLS: the server is started in the background.
# Linear's API answers whether apply noted a review of the PR: one noted an
# hour ago for each PR in CURL_STUB_REVIEWED, and just now for one in
# CURL_STUB_REVIEWING.
case "$*" in
  *api.linear.app*)
    pr=$(jq -r '.variables.m' | sed -E 's/.*review ([0-9]+).*/\1/')
    if [[ " ${CURL_STUB_REVIEWED:-} " == *" $pr "* ]]; then when=$(date -u -d -1hour +%FT%TZ)
    elif [[ " ${CURL_STUB_REVIEWING:-} " == *" $pr "* ]]; then when=$(date -u +%FT%TZ)
    else echo '{"data":{"comments":{"nodes":[]}}}'; exit 0; fi
    echo "{\"data\":{\"comments\":{\"nodes\":[{\"createdAt\":\"$when\"}]}}}"
    exit 0 ;;
esac
[ "${CURL_STUB:-up}" = up ] && [ -s "$RENDER_PID" ]
STUB

cat > "$BIN/npm" <<'STUB'
#!/usr/bin/env bash
echo "npm $* (cwd=$PWD)" >> "$NPM_LOG"
STUB

cat > "$BIN/node" <<'STUB'
#!/usr/bin/env bash
# dist/calibrate.js: the plan task's result, or apply's dry run, as the SDK
# client prints them. The dry run keeps the changeset.json it was run
# against, to show it ran on the rendered tree.
echo "node $2" >> "$CALLS"
echo "node $* (cwd=$PWD) RENDER_USE_LOCAL_DEV=${RENDER_USE_LOCAL_DEV:-} RENDER_LOCAL_DEV_URL=${RENDER_LOCAL_DEV_URL:-}" >> "$NODE_LOG"
case "$2 ${NODE_STUB_MODE:-ok}" in
  "plan fail") echo "Error: task plan ended failed: LINEAR_API_KEY must be set" >&2; exit 1 ;;
  "plan "*)
    echo '{"sinks":["CIT-439"],"order":[],"pruned":["CIT-500","CIT-501","CIT-502","CIT-777"],"cycles":[],"seen":{"CIT-500":"2026-10-21T01:00:00Z","CIT-501":"2026-10-21T02:00:00Z","CIT-502":"2026-10-21T03:00:00Z","CIT-777":"2026-10-21T04:00:00Z"}}'
    ;;
  "apply applyfail") echo "Error: the changeset does not apply as written: parent CIT-501: CIT-501 changed since planning" >&2; exit 1 ;;
  "apply "*)
    cp changeset.json "$DRY_RUN_SAW"
    echo '{"dryRun":true,"applied":[{"op":"create","target":"new:review-findings","detail":"\"Review findings on the supervisor\" under CIT-439 (infra, sonnet, medium)"},{"op":"parent","target":"CIT-500","detail":"into new:review-findings"},{"op":"parent","target":"CIT-501","detail":"into new:review-findings"},{"op":"decline","target":"CIT-502","detail":"nothing published depends on it"},{"op":"delegate","target":"new:review-findings","detail":"to tidelands-agent"}],"skipped":[],"clusters":{"new:review-findings":"new:review-findings"}}'
    ;;
  *) echo "unexpected node $*" >&2; exit 2 ;;
esac
STUB

cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh" >> "$CALLS"
echo "gh $*" >> "$GH_LOG"
case "$1 $2" in
  # The shipped branches: GH_STUB_BRANCHES, each ahead of main by
  # GH_STUB_AHEAD commits made just now, and with a PR already when it is
  # named in GH_STUB_HAS_PR.
  # The newest commit on main that changed the workflow: main's head.
  "api repos/null-hype/agent-plugins/commits?"*) git -C "$CALIBRATION_REMOTE" rev-parse main ;;
  "api repos/null-hype/agent-plugins/branches") printf '%s\n' main supervisor/calibration ${GH_STUB_BRANCHES:-} ;;
  # How many of a head's checks are not green: 2 for the head "red".
  # "none" for the head "nochecks", which has no passing check run.
  "api repos/null-hype/agent-plugins/commits/"*/check-runs*) case "$2" in */red/*) echo 2 ;; */nochecks/*) echo none ;; *) echo 0 ;; esac ;;
  "api repos/null-hype/agent-plugins/compare/"*) echo "${GH_STUB_AHEAD:-1} $(date -u +%FT%TZ) Duo left page: the claim in read-only Monaco" ;;
  "pr list")
    case "$*" in
      *"--head cit-"*) case " ${GH_STUB_HAS_PR:-} " in *" $6 "*) echo 1 ;; *) echo 0 ;; esac ;;
      # The supervisor's open shipped PRs, GH_STUB_SHIPPED_PRS: "number head"
      # lines, as the --jq filter prints them.
      *"--state open --limit 100"*) [ -z "${GH_STUB_SHIPPED_PRS:-}" ] || printf '%s\n' "$GH_STUB_SHIPPED_PRS" ;;
      *"--limit 200"*) echo '[{"number":298,"title":"toolbox: plumbing","state":"MERGED","isDraft":false,"mergedAt":"2026-10-22T08:14:00Z","headRefName":"claude/plumbing"},{"number":240,"title":"Duo left page","state":"MERGED","isDraft":false,"mergedAt":"2026-10-22T06:26:00Z","headRefName":"cit-446-duo","isCrossRepository":false},{"number":666,"title":"cit-446 fix, opened by the supervisor","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"cit-446-fork","isCrossRepository":true},{"number":999,"title":"Supervisor changeset","state":"OPEN","isDraft":false,"mergedAt":null,"headRefName":"supervisor/calibration"}]' ;;
      *) [ ! -s "$GH_OPEN_PR" ] || cat "$GH_OPEN_PR" ;;
    esac
    ;;
  "pr create"|"pr edit")
    prev=""
    for a in "$@"; do
      [ "$prev" = "--body-file" ] && cp "$a" "$GH_PR_BODY"
      prev=$a
    done
    case "$*" in
      *"--head cit-"*) echo "https://github.com/null-hype/agent-plugins/pull/240" ;;
      *) [ "$2" = edit ] || echo "https://github.com/null-hype/agent-plugins/pull/999" | tee "$GH_OPEN_PR" ;;
    esac
    ;;
  "pr view") echo "0123456789abcdef0123456789abcdef01234567" ;;
  # A PR whose checks have all passed: GitHub refuses auto-merge on it.
  "pr merge") [[ -z "${GH_STUB_CLEAN:-}" || "$*" != *--auto* ]] ||
    { echo "GraphQL: Pull request Pull request is in clean status (enablePullRequestAutoMerge)" >&2; exit 1; } ;;
esac
STUB

# apply-changeset.sh: start prints a task run id, or fails as
# APPLY_STUB_START asks; status fails for a run named in APPLY_STUB_FAILED.
cat > "$BIN/apply-changeset" <<'STUB'
#!/usr/bin/env bash
# Only a start is a step of the run; status is logged with the rest.
[ "$1" != start ] || echo "apply-start" >> "$CALLS"
echo "apply-changeset $* RENDER_API_KEY=${RENDER_API_KEY:-}" >> "$APPLY_LOG"
case "$1" in
  start) [ "${APPLY_STUB_START:-ok}" = ok ] || exit 1; echo "trn-$2" ;;
  status) [ "$2" != "${APPLY_STUB_FAILED:-}" ] ;;
esac
STUB
export APPLY_CHANGESET=$BIN/apply-changeset

chmod +x "$BIN/apply-changeset" "$BIN/pass-cli" "$BIN/restic" "$BIN/claude" "$BIN/render" "$BIN/curl" "$BIN/npm" "$BIN/node" "$BIN/gh"

export PATH="$BIN:$PATH"
export HOME=$WORK/home
mkdir -p "$HOME"
export PROTON_PASS_PERSONAL_ACCESS_TOKEN=stub-pass-token
# TOOLBOX_TOKEN is not set: the Render service holds only the pass token, and
# the toolbox token must come from supervisor.env through pass-cli.
unset TOOLBOX_TOKEN
export SUPERVISOR_TIMEOUT=2m
# Where mktemp puts the MCP and key files, so a run can be checked for
# leaving none behind.
export TMPDIR=$WORK/tmp
mkdir -p "$TMPDIR"
# Nothing a zone-per-service supervisor needed is set: the tick must not miss
# it. The defaults are what the first run asserts, wherever the test runs.
unset SUPERVISOR_ZONE SUPERVISOR_SESSION_ID SUPERVISOR_TZ SUPERVISOR_EFFORT SUPERVISOR_MODEL
export CALLS=$WORK/calls
export APPLY_LOG=$WORK/apply.log
export RESTIC_LOG=$WORK/restic.log
export PASS_ENVFILE_LOG=$WORK/pass-env.log
export PASS_ARGV_LOG=$WORK/pass-argv.log
export CLAUDE_ARGV=$WORK/argv
export CLAUDE_PWD=$WORK/pwd
export CLAUDE_MCP=$WORK/mcp.json
export CLAUDE_MCP_MODE=$WORK/mcp.mode
export RENDER_LOG=$WORK/render.log
export RENDER_PID=$WORK/render.pid
export NPM_LOG=$WORK/npm.log
export NODE_LOG=$WORK/node.log
export GH_LOG=$WORK/gh.log
export GH_OPEN_PR=$WORK/gh-open-pr
export GH_PR_BODY=$WORK/gh-pr-body
export DRY_RUN_SAW=$WORK/dry-run-saw.json

fail() { echo "FAIL: $*" >&2; exit 1; }

# A fresh container for each run: nothing from the last one is on disk.
reset() {
  rm -rf "$HOME" "$TMPDIR" "$CALLS" "$RESTIC_LOG" "$PASS_ENVFILE_LOG" "$PASS_ARGV_LOG" "$CLAUDE_ARGV" "$CLAUDE_PWD" "$CLAUDE_MCP" "$CLAUDE_MCP_MODE"
  mkdir -p "$HOME" "$TMPDIR"
  : > "$CALLS"
  : > "$RESTIC_LOG"
  : > "$PASS_ENVFILE_LOG"
  : > "$PASS_ARGV_LOG"
  rm -f "$RENDER_PID" "$GH_PR_BODY"
  : > "$RENDER_LOG"
  : > "$NPM_LOG"
  : > "$NODE_LOG"
  : > "$GH_LOG"
  : > "$APPLY_LOG"
}

# Prints the arguments that followed $1, up to the next flag.
section() {
  awk -v flag="$1" 'BEGIN { on = 0 } $0 == flag { on = 1; next } /^--/ { on = 0 } on { print }' "$CLAUDE_ARGV"
}

calls() { paste -sd' ' "$CALLS"; }

# --- the Render service ------------------------------------------------------

# One service, one schedule. The block is commented out until the image
# digest can be pinned, so it is read as comments.
[ -f "$RENDER_YAML" ] || fail "render.yaml should sit next to the supervisor directory"
[ "$(grep -cE '^ *#   name: ' "$RENDER_YAML")" = 1 ] ||
  fail "render.yaml should describe exactly one supervisor service"
grep -qxE ' *#   name: supervisor' "$RENDER_YAML" ||
  fail "the one service should be named supervisor"
[ "$(grep -cE '^ *#   schedule: ' "$RENDER_YAML")" = 1 ] ||
  fail "the supervisor should have exactly one schedule"
grep -qE '^ *#   schedule: "13 \* \* \* \*"$' "$RENDER_YAML" ||
  fail "the supervisor should run at minute 13 of every hour"
if grep -qE 'SUPERVISOR_(ZONE|TZ|SESSION_ID)' "$RENDER_YAML"; then
  fail "render.yaml should set no zone, timezone or session id"
fi

# One tick must not delay the next: the whole-run timeout is below the hour.
default_timeout=$(sed -n 's/.*SUPERVISOR_TIMEOUT:-\([0-9]*\)m.*/\1/p' "$DIR/supervisor.sh" | head -1)
{ [ -n "$default_timeout" ] && [ "$default_timeout" -lt 60 ]; } ||
  fail "SUPERVISOR_TIMEOUT should default to a number of minutes below the hour, got: ${default_timeout:-none}"

# --- nothing per zone, nothing per session -----------------------------------

if grep -nE 'SUPERVISOR_(ZONE|TZ|SESSION_ID)' "$DIR/supervisor.sh" "$DIR/supervisor.env" "$DIR/prompt.md"; then
  fail "the supervisor should read no zone, timezone or session id"
fi
if grep -niE 'midnight|timezone|zone|\{\{(ZONE|TZ|LOCAL_NOW|TO_MIDNIGHT|SINCE_MIDNIGHT)\}\}' "$DIR/prompt.md"; then
  fail "the prompt should carry no midnight, timezone or zone framing"
fi
if grep -q 'zone=' "$DIR/prompt.md"; then
  fail "the heartbeat format should not carry zone="
fi

# --- the repo a run clones and pushes to ------------------------------------

# The changeset is rendered by the real pkl against the real schema.
command -v pkl > /dev/null || fail "pkl must be on PATH: the run renders the changeset with it"
SCHEMA=$DIR/../workflow/pkl/Changeset.pkl
[ -f "$SCHEMA" ] || fail "the changeset schema should be at $SCHEMA"

# A bare repo whose main carries the workflow and its schema, so git itself is
# real and the pushed branch can be read back.
export GIT_AUTHOR_NAME=stub GIT_AUTHOR_EMAIL=stub@example.com
export GIT_COMMITTER_NAME=stub GIT_COMMITTER_EMAIL=stub@example.com
REMOTE=$WORK/remote.git
git init --quiet --bare --initial-branch=main "$REMOTE"
seed=$WORK/seed
WF=.dagger/internal/devenv-base/workflow
git init --quiet --initial-branch=main "$seed"
mkdir -p "$seed/$WF/pkl"
echo '{}' > "$seed/$WF/package.json"
# The changeset the previous run's PR merged.
echo '{"merged":"last hour"}' > "$seed/$WF/changeset.json"
SEED_HASH=$(sha256sum < "$seed/$WF/changeset.json" | cut -c1-16)
export SEED_HASH
cp "$SCHEMA" "$seed/$WF/pkl/Changeset.pkl"
git -C "$seed" add . && git -C "$seed" commit --quiet -m seed
git -C "$seed" push --quiet "$REMOTE" main
BASE_SHA=$(git -C "$seed" rev-parse HEAD)
export CALIBRATION_REMOTE=$REMOTE

tick() { bash "$DIR/supervisor.sh" "$@"; }
calibrate() { SUPERVISOR_MODE=calibrate bash "$DIR/supervisor.sh" "$@"; }
branch_sha() { git -C "$REMOTE" rev-parse --verify --quiet refs/heads/supervisor/calibration || true; }
no_pr() { [ -z "$(branch_sha)" ] && ! grep -q 'pr create' "$GH_LOG"; }
# Each run below starts with no changeset branch and no open PR.
fresh() {
  git -C "$REMOTE" update-ref -d refs/heads/supervisor/calibration 2> /dev/null || true
  rm -f "$GH_OPEN_PR"
  reset
}

# --- an hourly run -----------------------------------------------------------

fresh
RESTIC_STUB_APPLY=none CLAUDE_STUB_MODE=plan tick > "$WORK/out" 2>&1 ||
  fail "an hourly run should exit 0, got: $(cat "$WORK/out")"
grep -qx 'SUPERVISOR_PLAN: auto-merge pr=https://github.com/null-hype/agent-plugins/pull/999' "$WORK/out" ||
  fail "an hourly run should set its changeset PR to merge itself, got: $(cat "$WORK/out")"

[ "$(calls)" = "restic snapshots restic restore gh apply-start gh gh render node plan gh claude node apply gh gh gh gh restic backup" ] ||
  fail "expected restore, apply what merged, plan, continue, dry run, PR, auto-merge, then backup; got: $(calls)"
grep -qx 'gh pr merge https://github.com/null-hype/agent-plugins/pull/999 --repo null-hype/agent-plugins --auto --squash --match-head-commit 0123456789abcdef0123456789abcdef01234567' "$GH_LOG" ||
  fail "an hourly run should auto-merge the head it pushed, got: $(cat "$GH_LOG")"
grep -q 'pr checks' "$GH_LOG" && fail "an hourly run should not wait on its PR's checks"
# Merging is applying: the next run applies what merged, on main, with the
# Render key from Pass, keeps it with the session, and waits for it before
# planning.
grep -qx "apply-changeset start $BASE_SHA RENDER_API_KEY=resolved-RENDER_API_KEY" "$APPLY_LOG" ||
  fail "a run should apply main's changeset first, got: $(cat "$APPLY_LOG")"
grep -q "gh api repos/null-hype/agent-plugins/commits?sha=main&path=$WF&per_page=1" "$GH_LOG" ||
  fail "apply should name the newest commit that changed the workflow, which Render built, got: $(cat "$GH_LOG")"
grep -qx "apply-changeset wait trn-$BASE_SHA RENDER_API_KEY=resolved-RENDER_API_KEY" "$APPLY_LOG" ||
  fail "a run should wait for its apply before planning, got: $(cat "$APPLY_LOG")"
grep -qx "SUPERVISOR_APPLY: started run=trn-$BASE_SHA" "$WORK/out" ||
  fail "the run should report the apply it started, got: $(cat "$WORK/out")"
[ "$(cat "$HOME/.claude/supervisor-apply")" = "$SEED_HASH trn-$BASE_SHA" ] ||
  fail "the applied changeset and its task run should be kept with the session, got: $(cat "$HOME/.claude/supervisor-apply")"

# A changeset PR whose checks all passed already is merged directly:
# GitHub refuses auto-merge on it (the 14:13 run failed that way).
fresh
GH_STUB_CLEAN=1 CLAUDE_STUB_MODE=plan tick > "$WORK/clean" 2>&1 ||
  fail "a run whose changeset PR is already clean should pass, got: $(tail -5 "$WORK/clean")"
grep -qx 'gh pr merge https://github.com/null-hype/agent-plugins/pull/999 --repo null-hype/agent-plugins --squash --match-head-commit 0123456789abcdef0123456789abcdef01234567' "$GH_LOG" ||
  fail "a clean changeset PR should be merged directly, got: $(grep 'pr merge' "$GH_LOG")"

# Ops on issues no cluster names (ship, done, review) keep their issues in
# `seen`: the 07:13 run lost its ship to "was not seen by planning".
fresh
CLAUDE_STUB_MODE=plan-ship tick > "$WORK/out" 2>&1 ||
  fail "a run that ships should exit 0, got: $(tail -15 "$WORK/out")"
git -C "$REMOTE" show "supervisor/calibration:$WF/changeset.json" | jq -e '.seen["CIT-777"]' > /dev/null ||
  fail "a shipped issue should stay in seen, got: $(git -C "$REMOTE" show "supervisor/calibration:$WF/changeset.json")"

# A changeset already applied is not applied again; one whose apply failed is.
fresh
CLAUDE_STUB_MODE=plan tick > "$WORK/out" 2>&1 ||
  fail "a run after a good apply should exit 0, got: $(cat "$WORK/out")"
grep -q start "$APPLY_LOG" && fail "an applied changeset should not be applied again, got: $(cat "$APPLY_LOG")"
fresh
RESTIC_STUB_APPLY="$SEED_HASH trn-bad" APPLY_STUB_FAILED=trn-bad CLAUDE_STUB_MODE=plan tick > "$WORK/out" 2>&1 ||
  fail "a run after a failed apply should exit 0, got: $(cat "$WORK/out")"
grep -qx 'apply-changeset status trn-bad RENDER_API_KEY=resolved-RENDER_API_KEY' "$APPLY_LOG" &&
  grep -qx "apply-changeset start $BASE_SHA RENDER_API_KEY=resolved-RENDER_API_KEY" "$APPLY_LOG" ||
  fail "a failed apply should be started again, got: $(cat "$APPLY_LOG")"
# An apply that could not start is remembered, and the run fails loudly.
fresh
RESTIC_STUB_APPLY=none APPLY_STUB_START=fail CLAUDE_STUB_MODE=plan tick > "$WORK/out" 2>&1 ||
  fail "a run whose apply could not start should still plan, got: $(cat "$WORK/out")"
[ "$(cat "$HOME/.claude/supervisor-apply")" = failed ] ||
  fail "an apply that could not start should be remembered for the next run"
fresh
CLAUDE_STUB_MODE=plan tick > "$WORK/out" 2>&1 ||
  fail "an hourly run should exit 0, got: $(cat "$WORK/out")"
grep -qx 'gh pr merge https://github.com/null-hype/agent-plugins/pull/999 --repo null-hype/agent-plugins --auto --squash --match-head-commit 0123456789abcdef0123456789abcdef01234567' "$GH_LOG" ||
  fail "an hourly run should auto-merge the head it pushed, got: $(cat "$GH_LOG")"

# The restore: the newest snapshot under the one tag, without the daemon's
# runtime state.
grep -q -- 'snapshots --json --tag supervisor ' "$RESTIC_LOG" ||
  fail "the restore should list the snapshots tagged supervisor"
grep -q -- 'restore snap-new --target '"$HOME"' --exclude /.claude/daemon\* --exclude /.claude/jobs' "$RESTIC_LOG" ||
  fail "the restore should take the newest snapshot, minus daemon and jobs"
[ -s "$HOME/.claude.json" ] ||
  fail "a missing ~/.claude.json should be restored from Claude's backups"

# The continue: the newest session of /workspaces/agent-plugins, Remote
# Control on, in the foreground.
grep -qx -- '--continue' "$CLAUDE_ARGV" ||
  fail "claude should be run with --continue"
if grep -qx -- '--resume' "$CLAUDE_ARGV" || grep -q '6f51ed1a' "$CLAUDE_ARGV"; then
  fail "claude should be given no session id: --continue finds the session by directory"
fi
[ "$(cat "$CLAUDE_PWD")" = /workspaces/agent-plugins ] ||
  fail "claude should run from /workspaces/agent-plugins, got: $(cat "$CLAUDE_PWD")"
grep -qx -- '--remote-control' "$CLAUDE_ARGV" ||
  fail "--remote-control should be passed"
[ "$(section --model)" = sonnet ] && [ "$(section --effort)" = medium ] ||
  fail "an hourly run should use sonnet at medium effort by default, got: $(section --model) $(section --effort)"
grep -qx -- '-p' "$CLAUDE_ARGV" ||
  fail "the continue should run in the foreground with -p"
if grep -qx -- '--bg' "$CLAUDE_ARGV"; then
  fail "--bg would end with the Render container; the continue must stay in the foreground"
fi

# The backup: from $HOME, relative, so the snapshot restores with the same
# --target and --exclude the restore uses.
grep -q -- "backup .claude --tag supervisor (cwd=$HOME)" "$RESTIC_LOG" ||
  fail "the backup should run from \$HOME on the relative path .claude, under the tag supervisor"

# No session id and no zone is asked of Proton Pass.
if grep -qiE 'SESSION_ID|ZONE|_TZ' "$PASS_ENVFILE_LOG"; then
  fail "the env file handed to pass-cli should hold no session id, zone or timezone"
fi

# --- the prompt --------------------------------------------------------------

grep -q 'You are the supervisor of the agent-plugins project' "$CLAUDE_ARGV" ||
  fail "the prompt should be prompt.md"
grep -q 'Duo editor' "$CLAUDE_ARGV" && grep -q 'Duo comes first' "$CLAUDE_ARGV" ||
  fail "the prompt should put the Duo editor first"
grep -q 'SUPERVISOR_CHANGESET:' "$CLAUDE_ARGV" ||
  fail "the prompt should end with the changeset format"
grep -q '"pruned": \[' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the frozen plan"
if grep -q '"seen"' "$CLAUDE_ARGV"; then
  fail "the prompt should leave out the plan's seen: the run fills it in"
fi
grep -q '"number":240,"title":"Duo left page","state":"MERGED"' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the recent pull requests"
if grep -q '"headRefName":"supervisor/calibration"' "$CLAUDE_ARGV"; then
  fail "the prompt should leave the changeset PRs out of the pull requests"
fi
if grep -q '"headRefName":"claude/plumbing"' "$CLAUDE_ARGV"; then
  fail "the prompt should leave merged PRs of non-issue branches out: they crowd out the issue PRs"
fi
if grep -q '"headRefName":"cit-446-fork"' "$CLAUDE_ARGV"; then
  fail "the prompt should leave fork PRs out: planning would make them review candidates"
fi
grep -qE 'Now, UTC: \*\*[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the current UTC time"
if grep -q '{{' "$CLAUDE_ARGV"; then
  fail "every prompt placeholder should have been substituted"
fi
if grep -qiE 'midnight|timezone|zone|\bhats?\b' "$CLAUDE_ARGV"; then
  fail "the prompt should carry no midnight, timezone, zone or hat framing"
fi

# --- the tools ---------------------------------------------------------------

grep -q 'Bearer resolved-TOOLBOX_TOKEN' "$CLAUDE_MCP" ||
  fail "the MCP config should carry the toolbox bearer token, resolved from pass"
grep -q 'resolved-LINEAR_API_KEY' "$CLAUDE_MCP" ||
  fail "the MCP config should carry the Linear key"
[ "$(jq -r '.mcpServers.linear.url' "$CLAUDE_MCP")" = "https://mcp.linear.app/mcp" ] ||
  fail "Linear should be an explicit MCP server: --strict-mcp-config leaves no connector to rely on"
[ "$(cat "$CLAUDE_MCP_MODE")" = 600 ] ||
  fail "the MCP config holds bearer tokens and should be mode 0600, got $(cat "$CLAUDE_MCP_MODE")"
for secret in resolved-TOOLBOX_TOKEN resolved-LINEAR_API_KEY resolved-CLAUDE_CODE_OAUTH_TOKEN resolved-RESTIC_PASSWORD resolved-GITHUB_TOKEN; do
  if grep -q "$secret" "$CLAUDE_ARGV"; then
    fail "$secret must never appear in claude's argv"
  fi
  if grep -q "$secret" "$PASS_ARGV_LOG" "$RESTIC_LOG" "$GH_LOG" "$RENDER_LOG" "$NODE_LOG" "$NPM_LOG"; then
    fail "$secret must never appear on an argv"
  fi
  if grep -rq "$secret" "$HOME" "$TMPDIR"; then
    fail "$secret must not be left in a file once the run has ended"
  fi
done
[ -z "$(ls -A "$TMPDIR")" ] ||
  fail "the 0600 MCP and key files and the clone should be removed on exit, left: $(ls "$TMPDIR")"

# Every secret is resolved by pass-cli run from supervisor.env, and the
# Render service is not asked to carry any of them.
grep -qx 'TOOLBOX_TOKEN=pass://infra/render.com/TOOLBOX_TOKEN' "$PASS_ENVFILE_LOG" ||
  fail "the env file handed to pass-cli run should reference the toolbox token in Proton Pass"
grep -qx 'GITHUB_TOKEN=pass://infra/github.com/GITHUB_TOKEN' "$PASS_ENVFILE_LOG" ||
  fail "supervisor.env should reference the GitHub token in Proton Pass: the run opens and merges a PR"
grep -q -- "pass-cli run --env-file $DIR/supervisor.env -- " "$PASS_ARGV_LOG" ||
  fail "the secrets should be resolved with pass-cli run --env-file supervisor.env"
if grep -v '^ *#' "$DIR/supervisor.env" | grep -E '^[A-Z_]+=' | grep -v '=pass://' ; then
  fail "supervisor.env should hold pass:// references only"
fi
if grep -q 'TOOLBOX_TOKEN' "$RENDER_YAML"; then
  fail "render.yaml should not ask the service for TOOLBOX_TOKEN: it comes from Proton Pass"
fi
grep -qx -- '--strict-mcp-config' "$CLAUDE_ARGV" ||
  fail "--strict-mcp-config should be passed, so no other MCP server joins in"

# Read-only: Linear's read tools, never the Linear server as a whole, and
# every tool that writes, starts, stops or ships denied by name.
if section --allowedTools | grep -qx mcp__linear; then
  fail "the run must not allow the Linear server as a whole"
fi
for tool in mcp__toolbox__host_status mcp__toolbox__workspace_list mcp__toolbox__workspace_status \
  mcp__toolbox__agent_ship_status mcp__linear__list_issues mcp__linear__get_issue mcp__linear__list_comments \
  mcp__linear__list_initiatives mcp__linear__get_initiative mcp__linear__get_status_updates; do
  section --allowedTools | grep -qx "$tool" || fail "$tool should be allowed"
done
if section --allowedTools | grep -E '^mcp__linear__(save|create|delete|update|merge|submit|resolve|share|unshare|mark)_'; then
  fail "the run must not allow a Linear tool that writes"
fi
for tool in mcp__toolbox__host_start mcp__toolbox__host_stop mcp__toolbox__host_wake mcp__toolbox__agent_start \
  mcp__toolbox__agent_ship mcp__toolbox__workspace_delete mcp__toolbox__codespace_rebuild \
  mcp__linear__save_issue mcp__linear__save_comment mcp__linear__create_issue_label \
  mcp__linear__save_initiative mcp__linear__save_status_update Bash Write Edit; do
  if section --allowedTools | grep -qx "$tool"; then
    fail "$tool must not be in the allowed list"
  fi
  section --disallowedTools | grep -qx "$tool" ||
    fail "$tool should be disallowed by name as well"
done

# --- settings the old per-zone services carried are ignored ------------------

fresh
SUPERVISOR_ZONE=infrastructure SUPERVISOR_TZ=Asia/Hong_Kong SUPERVISOR_SESSION_ID=bogus-session \
  CLAUDE_STUB_MODE=plan tick > /dev/null 2>&1 ||
  fail "a run with leftover zone settings should still pass"
if grep -q 'bogus-session' "$CLAUDE_ARGV" || grep -q 'infrastructure' "$RESTIC_LOG"; then
  fail "a leftover zone or session id must not reach claude or restic"
fi
grep -q -- 'backup .claude --tag supervisor (cwd=' "$RESTIC_LOG" ||
  fail "a leftover zone must not change the restic tag"

# SUPERVISOR_MODEL and SUPERVISOR_EFFORT override the defaults.
fresh
SUPERVISOR_MODEL=opus SUPERVISOR_EFFORT=high CLAUDE_STUB_MODE=plan tick > /dev/null 2>&1 ||
  fail "a run with SUPERVISOR_MODEL and SUPERVISOR_EFFORT set should pass"
[ "$(section --model)" = opus ] && [ "$(section --effort)" = high ] ||
  fail "SUPERVISOR_MODEL and SUPERVISOR_EFFORT should be passed through, got: $(section --model) $(section --effort)"

# --- there is no Proton Pass session -----------------------------------------

# Every secret, the toolbox token among them, comes through pass-cli, so with
# no session and a login that fails nothing may run: not the restore, not
# claude, not a backup.
fresh
if PASS_STUB_SESSION=none tick > "$WORK/nopass" 2>&1; then
  fail "a run with no Proton Pass session should fail"
fi
grep -q 'could not log in to Proton Pass' "$WORK/nopass" ||
  fail "a missing pass session should say so, got: $(cat "$WORK/nopass")"
[ -z "$(calls)" ] ||
  fail "with no pass session nothing should run; got: $(calls)"
if grep -q -- 'pass-cli run' "$PASS_ARGV_LOG"; then
  fail "with no pass session no secret should be resolved"
fi

# Without the pass token the service cannot log in at all.
fresh
if env -u PROTON_PASS_PERSONAL_ACCESS_TOKEN bash "$DIR/supervisor.sh" > "$WORK/notoken" 2>&1; then
  fail "a run without PROTON_PASS_PERSONAL_ACCESS_TOKEN should fail"
fi
grep -q 'PROTON_PASS_PERSONAL_ACCESS_TOKEN must be set' "$WORK/notoken" ||
  fail "a missing pass token should name the variable, got: $(cat "$WORK/notoken")"
[ -z "$(calls)" ] ||
  fail "without the pass token nothing should run; got: $(calls)"

# --- the restore fails -------------------------------------------------------

# No snapshot carries the tag: fail loudly, and do not continue a session
# that is not there (or back up an empty ~/.claude over the real one).
fresh
if RESTIC_STUB_SNAPSHOTS=miss tick > "$WORK/nosnap" 2>&1; then
  fail "a missing snapshot should fail the run"
fi
grep -q 'no snapshot tagged supervisor' "$WORK/nosnap" ||
  fail "a missing snapshot should say which tag it looked for"
[ "$(calls)" = "restic snapshots" ] ||
  fail "with no snapshot neither claude nor a backup should run; got: $(calls)"

# A snapshot with no session for /workspaces/agent-plugins would have
# --continue start a fresh, amnesiac one: refuse before claude runs.
fresh
if RESTIC_STUB_RESTORE=elsewhere tick > "$WORK/nosession" 2>&1; then
  fail "a snapshot without a session for the working directory should fail the run"
fi
grep -q 'did not produce a session for /workspaces/agent-plugins' "$WORK/nosession" ||
  fail "a snapshot without the session should say which directory it expected"
[ "$(calls)" = "restic snapshots restic restore" ] ||
  fail "without the session neither claude nor a backup should run; got: $(calls)"

# --- claude fails ------------------------------------------------------------

fresh
if CLAUDE_STUB_MODE=fail tick > "$WORK/broken" 2>&1; then
  fail "a run where claude exited nonzero should fail"
fi
grep -q 'claude exited 3 -- this tick has no changeset' "$WORK/broken" ||
  fail "a failed claude run should report its exit status, got: $(cat "$WORK/broken")"
[ "$(calls)" = "restic snapshots restic restore gh gh render node plan gh claude restic backup" ] && no_pr ||
  fail "a failing claude should open no PR, and still be backed up; got: $(calls)"

fresh
if CLAUDE_STUB_MODE=hang SUPERVISOR_CLAUDE_TIMEOUT=1s tick > "$WORK/hung" 2>&1; then
  fail "a claude that outlives its wall-clock timeout should fail the run"
fi
grep -q 'claude timed out after 1s' "$WORK/hung" ||
  fail "a timed-out claude should say so"
[ "$(calls)" = "restic snapshots restic restore gh gh render node plan gh claude restic backup" ] ||
  fail "the backup should run after a timed-out claude; got: $(calls)"

fresh
if CLAUDE_STUB_MODE=prose tick > "$WORK/prose" 2>&1; then
  fail "a run that produced no changeset should fail"
fi
grep -q 'no SUPERVISOR_CHANGESET line followed by a pkl block' "$WORK/prose" ||
  fail "a missing changeset should say so"
[ "$(calls)" = "restic snapshots restic restore gh gh render node plan gh claude restic backup" ] && no_pr ||
  fail "a run without a changeset should open no PR, and still be backed up; got: $(calls)"

# A changeset that does not render goes back to the same session once.
fresh
CLAUDE_STUB_MODE=badpkl-once tick > "$WORK/tickfixed" 2>&1 ||
  fail "a changeset fixed on the second ask should pass, got: $(cat "$WORK/tickfixed")"
grep -q 'Your last changeset did not render' "$CLAUDE_ARGV" && grep -qx -- '--continue' "$CLAUDE_ARGV" ||
  fail "the second ask should continue the session, with the render error"

# A shipped branch with no PR gets one; a branch that has one, or is not
# ahead of main, does not.
fresh
GH_STUB_BRANCHES="cit-446-duo-left-page cit-465-pkl-cards" GH_STUB_HAS_PR=cit-465-pkl-cards \
  CLAUDE_STUB_MODE=plan tick > "$WORK/shipped" 2>&1 ||
  fail "a run with a shipped branch should pass, got: $(cat "$WORK/shipped")"
grep -qx 'gh pr create --repo null-hype/agent-plugins --base main --head cit-446-duo-left-page --title CIT-446: Duo left page: the claim in read-only Monaco --body .*agent_ship.*' "$GH_LOG" ||
  fail "a shipped branch without a PR should get one, titled from its issue, got: $(cat "$GH_LOG")"
grep -q 'opened https://github.com/null-hype/agent-plugins/pull/240 for the shipped branch cit-446-duo-left-page' "$WORK/shipped" ||
  fail "the run should name the PR it opened"
if grep -q -- '--head cit-465-pkl-cards --title' "$GH_LOG"; then
  fail "a shipped branch that has a PR should not get a second"
fi
# Only this repository's own PRs, opened by its owner, are candidates: a
# fork's branch name and body are its author's to choose.
grep -q -- '--state open --limit 100 --json number,headRefName,headRefOid,body,isCrossRepository,author --jq .*isCrossRepository | not) and .author.login == "null-hype"' "$GH_LOG" ||
  fail "the shipped-PR merge should select only same-repository PRs by the owner, got: $(grep 'state open --limit 100' "$GH_LOG")"
# A shipped PR merges on green only once Codex has reviewed it: not before
# its review, nor while the review is still filing, nor with red checks.
fresh
GH_STUB_SHIPPED_PRS=$'240 green\n241 red\n242 green\n243 green\n244 nochecks' CURL_STUB_REVIEWED="240 241 244" CURL_STUB_REVIEWING=243 \
  CLAUDE_STUB_MODE=plan tick > "$WORK/merged" 2>&1 ||
  fail "a run with shipped PRs should pass, got: $(cat "$WORK/merged")"
grep -qx 'gh pr merge 240 --repo null-hype/agent-plugins --squash --match-head-commit green' "$GH_LOG" &&
  grep -q 'merged the reviewed PR #240' "$WORK/merged" ||
  fail "a reviewed, green shipped PR should merge, got: $(cat "$GH_LOG")"
if grep -qE 'gh pr merge 24[1234]' "$GH_LOG"; then
  fail "a shipped PR with red checks, no review or a review under way should not merge, got: $(grep "pr merge" "$GH_LOG"; cat "$WORK/merged")"
fi
grep -q '#241 waits on 2 check' "$WORK/merged" && grep -q '#242 waits for its Codex review' "$WORK/merged" &&
  grep -q '#243 is still in its Codex review' "$WORK/merged" && grep -q '#244 has no passing check yet' "$WORK/merged" ||
  fail "the run should say why each shipped PR waits, got: $(cat "$WORK/merged")"
fresh
GH_STUB_BRANCHES=cit-446-duo-left-page GH_STUB_AHEAD=0 CLAUDE_STUB_MODE=plan tick > /dev/null 2>&1 ||
  fail "a run with a branch main already has should pass"
if grep -q -- '--head cit-' "$GH_LOG" | grep -q 'pr create'; then
  fail "a branch with nothing main lacks should get no PR"
fi
grep -c 'pr create' "$GH_LOG" | grep -qx 1 ||
  fail "only the changeset PR should be opened when no branch is ahead, got: $(cat "$GH_LOG")"
# A calibration opens no PR but its own.
fresh
GH_STUB_BRANCHES=cit-446-duo-left-page CLAUDE_STUB_MODE=plan calibrate > /dev/null 2>&1 ||
  fail "a calibration with a shipped branch around should pass"
if grep -q -- '--head cit-' "$GH_LOG"; then
  fail "a calibration should leave shipped branches alone"
fi

# A failed backup fails a run that otherwise worked: the next run would
# continue from an older transcript.
fresh
if RESTIC_STUB_BACKUP=fail CLAUDE_STUB_MODE=plan tick > "$WORK/nobackup" 2>&1; then
  fail "a run whose backup failed should fail"
fi
grep -q 'restic backup exited 1' "$WORK/nobackup" ||
  fail "a failed backup should say so, got: $(cat "$WORK/nobackup")"

# --- calibration -------------------------------------------------------------

# A green calibration.
fresh
CLAUDE_STUB_MODE=plan calibrate > "$WORK/cal" 2>&1 ||
  fail "a green calibration should exit 0, got: $(cat "$WORK/cal")"
grep -qx 'SUPERVISOR_CHANGESET: ops=5 clusters=1' "$WORK/cal" ||
  fail "a calibration should print its changeset summary, got: $(cat "$WORK/cal")"
tail -1 "$WORK/cal" | grep -qx 'SUPERVISOR_PLAN: proposed pr=https://github.com/null-hype/agent-plugins/pull/999' ||
  fail "a calibration off the tick should end proposing its PR, got: $(tail -1 "$WORK/cal")"
if grep -q 'pr merge' "$GH_LOG"; then
  fail "a calibration off the tick must not merge its PR"
fi
[ "$(calls)" = "render node plan gh claude node apply gh gh" ] ||
  fail "a calibration should start the dev server, plan, run planning, dry-run apply, then open the PR, and never touch restic; got: $(calls)"

# Its secrets are its own: a GitHub token, and no restic.
grep -q -- "pass-cli run --env-file $DIR/calibrate.env -- " "$PASS_ARGV_LOG" ||
  fail "a calibration should resolve calibrate.env"
grep -qx 'GITHUB_TOKEN=pass://infra/github.com/GITHUB_TOKEN' "$PASS_ENVFILE_LOG" ||
  fail "calibrate.env should reference the GitHub token in Proton Pass"
if grep -q RESTIC "$PASS_ENVFILE_LOG"; then
  fail "a calibration keeps no transcript and should resolve no restic secret"
fi

# The workflow is built from the clone and run on the local task server.
grep -q '^npm ci .*workflow)$' "$NPM_LOG" && grep -q '^npm run build .*workflow)$' "$NPM_LOG" ||
  fail "the workflow should be built in the clone, got: $(cat "$NPM_LOG")"
grep -qx 'render workflows dev -- npm start (cwd=.*/repo/.dagger/internal/devenv-base/workflow)' "$RENDER_LOG" ||
  fail "the dev server should be render workflows dev -- npm start in the clone's workflow, got: $(cat "$RENDER_LOG")"
grep -q '^node dist/calibrate.js plan CIT CIT-439 (cwd=.*workflow) RENDER_USE_LOCAL_DEV=true RENDER_LOCAL_DEV_URL=http://127.0.0.1:8120$' "$NODE_LOG" ||
  fail "the plan task should run through the SDK's local mode, got: $(cat "$NODE_LOG")"
grep -q '^node dist/calibrate.js apply CIT (cwd=.*workflow) RENDER_USE_LOCAL_DEV=true ' "$NODE_LOG" ||
  fail "apply should be dry-run through the SDK's local mode, got: $(cat "$NODE_LOG")"
if kill -0 "$(cat "$RENDER_PID")" 2> /dev/null; then
  fail "the dev server should be stopped when the calibration ends"
fi

# Nothing deploys: render is only ever the dev server.
[ "$(wc -l < "$RENDER_LOG")" = 1 ] ||
  fail "render should be called once, for the dev server, got: $(cat "$RENDER_LOG")"
if grep -qiE 'deploy' "$RENDER_LOG" "$GH_LOG"; then
  fail "a calibration must not deploy"
fi

# Planning runs fresh, cheap and read-only, from the planning prompt alone.
for flag in --continue --remote-control --resume; do
  if grep -qx -- "$flag" "$CLAUDE_ARGV"; then
    fail "a calibration is a fresh session and should not pass $flag"
  fi
done
[ "$(section --model)" = haiku ] && [ "$(section --effort)" = low ] ||
  fail "a calibration should run a small model at low effort, got: $(section --model) $(section --effort)"
grep -q 'You are the supervisor of the agent-plugins project' "$CLAUDE_ARGV" ||
  fail "a calibration should use the same prompt.md"
grep -q '"pruned": \[' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the frozen plan"
if grep -q '"seen"' "$CLAUDE_ARGV"; then
  fail "the prompt should leave out the plan's seen: the run fills it in"
fi
if grep -q '{{' "$CLAUDE_ARGV"; then
  fail "every calibration prompt placeholder should have been substituted"
fi

# Planning makes no Linear writes: it may read Linear, every tool that
# writes is denied, and Linear is not allowed as a whole.
if section --allowedTools | grep -qx mcp__linear; then
  fail "a calibration must not allow the Linear server as a whole"
fi
for tool in mcp__linear__list_issues mcp__linear__get_issue mcp__linear__list_comments mcp__toolbox__host_status \
  mcp__linear__list_initiatives mcp__linear__get_initiative mcp__linear__get_status_updates; do
  section --allowedTools | grep -qx "$tool" || fail "$tool should be allowed in a calibration"
done
if section --allowedTools | grep -E '^mcp__linear__(save|create|delete|update|merge|submit|resolve|share|unshare|mark)_'; then
  fail "a calibration must not allow a Linear tool that writes"
fi
for tool in mcp__linear__save_issue mcp__linear__save_comment mcp__linear__delete_comment \
  mcp__linear__create_issue_label mcp__linear__save_initiative mcp__linear__save_status_update \
  mcp__toolbox__host_start Bash; do
  section --disallowedTools | grep -qx "$tool" || fail "$tool should be disallowed by name in a calibration"
done

# The changeset is pushed to calibration's own branch, one commit on the
# base: the Pkl source and its rendering, and `seen` holds exactly the
# issues it touches, as the plan saw them.
[ -n "$(branch_sha)" ] || fail "a green calibration should push supervisor/calibration"
[ "$(git -C "$REMOTE" rev-parse supervisor/calibration~1)" = "$BASE_SHA" ] ||
  fail "the calibration branch should be one commit on the base"
[ "$(git -C "$REMOTE" diff --name-only main supervisor/calibration | paste -sd' ')" = "$WF/changeset.json $WF/changeset.pkl" ] ||
  fail "the calibration commit should carry changeset.pkl and changeset.json only, got: $(git -C "$REMOTE" diff --name-only main supervisor/calibration)"
git -C "$REMOTE" show "supervisor/calibration:$WF/changeset.json" > "$WORK/changeset.json"
jq -e '.seen == {"CIT-500":"2026-10-21T01:00:00Z","CIT-501":"2026-10-21T02:00:00Z","CIT-502":"2026-10-21T03:00:00Z"}
  and .clusters[0].key == "new:review-findings" and .clusters[0].issues == ["CIT-500","CIT-501"]
  and .decline[0].issue == "CIT-502" and .delegate[0].agent == "tidelands-agent"' "$WORK/changeset.json" > /dev/null ||
  fail "the committed changeset should hold planning's ops and seen for the issues it touches, got: $(cat "$WORK/changeset.json")"
check=$WORK/check
rm -rf "$check" && git clone --quiet --branch supervisor/calibration "$REMOTE" "$check"
(cd "$check/$WF" && pkl eval -f json changeset.pkl) | cmp -s - "$check/$WF/changeset.json" ||
  fail "the committed changeset.json should be the rendering of the committed changeset.pkl"
cmp -s "$DRY_RUN_SAW" "$WORK/changeset.json" ||
  fail "apply should have been dry-run against the changeset that was committed"
grep -qx 'gh pr create --repo null-hype/agent-plugins --base main --head supervisor/calibration --title Supervisor changeset --body-file .*' "$GH_LOG" ||
  fail "a green calibration should open a PR from supervisor/calibration into main, got: $(cat "$GH_LOG")"
grep -q 'Merging this applies it' "$GH_PR_BODY" && grep -qx '| delegate | new:review-findings | to tidelands-agent |' "$GH_PR_BODY" ||
  fail "the PR body should say merging applies it and list the dry run's ops, got: $(cat "$GH_PR_BODY")"
grep -q 'changeset PR https://github.com/null-hype/agent-plugins/pull/999' "$WORK/cal" ||
  fail "the run should name its PR"

# No token on any argv, and nothing left behind.
for secret in resolved-GITHUB_TOKEN resolved-LINEAR_API_KEY resolved-TOOLBOX_TOKEN; do
  if grep -q "$secret" "$CLAUDE_ARGV" "$PASS_ARGV_LOG" "$GH_LOG" "$RENDER_LOG" "$NODE_LOG" "$NPM_LOG"; then
    fail "$secret must never appear on an argv"
  fi
done
[ -z "$(ls -A "$TMPDIR")" ] ||
  fail "a calibration should leave nothing in TMPDIR, left: $(ls "$TMPDIR")"

# The same changeset again, with the PR open: nothing is pushed and no
# second PR is opened.
before=$(branch_sha)
reset
CLAUDE_STUB_MODE=plan calibrate > "$WORK/cal2" 2>&1 ||
  fail "a repeated calibration should exit 0, got: $(cat "$WORK/cal2")"
[ "$(branch_sha)" = "$before" ] ||
  fail "an unchanged changeset should push nothing"
grep -q 'the changeset is unchanged' "$WORK/cal2" || fail "an unchanged changeset should say so"
if grep -q 'pr create' "$GH_LOG"; then
  fail "with the calibration PR open, no second PR should be opened"
fi
grep -qx 'gh pr edit https://github.com/null-hype/agent-plugins/pull/999 --repo null-hype/agent-plugins --body-file .*' "$GH_LOG" &&
  grep -qx '| delegate | new:review-findings | to tidelands-agent |' "$GH_PR_BODY" ||
  fail "the open PR's body should be rewritten from this run's dry run, got: $(cat "$GH_LOG")"

# A calibration asked to merge sets auto-merge on the head it pushed, and
# applies nothing: that is the next hourly run's.
reset
CALIBRATION_MERGE=1 CLAUDE_STUB_MODE=plan calibrate > "$WORK/calmerge" 2>&1 ||
  fail "a merging calibration should exit 0, got: $(cat "$WORK/calmerge")"
grep -qx 'gh pr merge https://github.com/null-hype/agent-plugins/pull/999 --repo null-hype/agent-plugins --auto --squash --match-head-commit 0123456789abcdef0123456789abcdef01234567' "$GH_LOG" ||
  fail "a merging calibration should auto-merge the head it pushed, got: $(cat "$GH_LOG")"
tail -1 "$WORK/calmerge" | grep -qx 'SUPERVISOR_PLAN: auto-merge pr=https://github.com/null-hype/agent-plugins/pull/999' ||
  fail "a merging calibration should say so last, got: $(tail -1 "$WORK/calmerge")"
[ ! -s "$APPLY_LOG" ] || fail "a calibration should apply nothing, got: $(cat "$APPLY_LOG")"

# A plan the base already carries proposes nothing, so a merged plan is not
# proposed and merged again on every tick.
git -C "$REMOTE" show "supervisor/calibration:$WF/changeset.json" > "$seed/$WF/changeset.json"
git -C "$seed" add . && git -C "$seed" commit --quiet -m "the plan, merged"
git -C "$seed" push --quiet "$REMOTE" main
before=$(branch_sha)
reset
CALIBRATION_MERGE=1 CLAUDE_STUB_MODE=plan calibrate > "$WORK/calsame" 2>&1 ||
  fail "a calibration whose plan matches the base should exit 0, got: $(cat "$WORK/calsame")"
grep -q 'the plan matches main; nothing to propose' "$WORK/calsame" &&
  tail -1 "$WORK/calsame" | grep -qx 'SUPERVISOR_PLAN: unchanged' ||
  fail "a plan the base carries should say so, got: $(cat "$WORK/calsame")"
# Reading the recent pull requests for the prompt is the one gh call.
[ "$(branch_sha)" = "$before" ] && ! grep -v -- '--limit 200' "$GH_LOG" | grep -q . ||
  fail "a plan the base carries should push nothing and touch no PR, got: $(cat "$GH_LOG")"
git -C "$seed" reset --quiet --hard "$BASE_SHA"
git -C "$seed" push --quiet --force "$REMOTE" main

# A changeset that does not type-check never reaches the dry run or a PR.
git -C "$REMOTE" update-ref -d refs/heads/supervisor/calibration
rm -f "$GH_OPEN_PR"
reset
if CLAUDE_STUB_MODE=badpkl calibrate > "$WORK/calbad" 2>&1; then
  fail "a changeset that does not render should fail the calibration"
fi
grep -q 'the changeset does not render through pkl/Changeset.pkl' "$WORK/calbad" ||
  fail "a changeset that does not render should say so, got: $(cat "$WORK/calbad")"
[ "$(calls)" = "render node plan gh claude claude" ] && no_pr ||
  fail "a changeset that does not render, twice, should not be dry-run, pushed or opened; got: $(calls)"
grep -q 'asking again, with the render error' "$WORK/calbad" ||
  fail "a changeset that does not render should go back to planning once, got: $(cat "$WORK/calbad")"

# Planning gets one more go with the render error, and a fixed changeset
# goes on as usual.
reset
CLAUDE_STUB_MODE=badpkl-once calibrate > "$WORK/calfixed" 2>&1 ||
  fail "a changeset fixed on the second planning run should pass, got: $(cat "$WORK/calfixed")"
[ "$(calls)" = "render node plan gh claude claude node apply gh gh" ] ||
  fail "a fixed changeset should be dry-run and proposed, got: $(calls)"
grep -q 'Your last changeset did not render' "$CLAUDE_ARGV" ||
  fail "the second planning run should be given the render error"
git -C "$REMOTE" update-ref -d refs/heads/supervisor/calibration
rm -f "$GH_OPEN_PR"

# No changeset block, no PR.
reset
if CLAUDE_STUB_MODE=prose calibrate > "$WORK/calprose" 2>&1; then
  fail "a calibration without a changeset should fail"
fi
grep -q 'no SUPERVISOR_CHANGESET line followed by a pkl block' "$WORK/calprose" ||
  fail "a missing changeset should say so, got: $(cat "$WORK/calprose")"
no_pr || fail "a calibration without a changeset should push nothing and open no PR"

# A changeset whose dry run fails is not ready to merge.
reset
if NODE_STUB_MODE=applyfail CLAUDE_STUB_MODE=plan calibrate > "$WORK/caldry" 2>&1; then
  fail "a calibration whose dry run failed should fail"
fi
grep -q "the changeset's dry run failed" "$WORK/caldry" ||
  fail "a failed dry run should say so, got: $(cat "$WORK/caldry")"
no_pr || fail "a calibration whose dry run failed should push nothing and open no PR"

# A failed claude is a failed calibration.
reset
if CLAUDE_STUB_MODE=fail calibrate > "$WORK/calfail" 2>&1; then
  fail "a calibration where claude exited nonzero should fail"
fi
grep -q 'claude exited 3 -- this calibrate has no changeset' "$WORK/calfail" ||
  fail "a failed claude should be reported, got: $(cat "$WORK/calfail")"
no_pr || fail "a calibration where claude failed should push nothing and open no PR"

# No plan, no planning: a failed plan task is never read as an empty plan.
reset
if NODE_STUB_MODE=fail CLAUDE_STUB_MODE=plan calibrate > "$WORK/calnoplan" 2>&1; then
  fail "a calibration whose plan task failed should fail"
fi
grep -q 'the plan task produced no plan' "$WORK/calnoplan" ||
  fail "a failed plan task should say so, got: $(cat "$WORK/calnoplan")"
[ "$(calls)" = "render node plan" ] ||
  fail "without a plan neither planning nor gh should run; got: $(calls)"

# A dev server that never answers fails before the plan.
reset
if CURL_STUB=down CALIBRATION_DEV_WAIT=2 CLAUDE_STUB_MODE=plan calibrate > "$WORK/caldown" 2>&1; then
  fail "a calibration whose dev server never came up should fail"
fi
grep -q 'the local task server never came up' "$WORK/caldown" ||
  fail "a dev server that never came up should say so, got: $(cat "$WORK/caldown")"
[ "$(calls)" = "render" ] ||
  fail "without a dev server nothing else should run; got: $(calls)"

# Calibrating another branch never touches main's calibration branch or PR.
git -C "$REMOTE" update-ref -d refs/heads/supervisor/calibration
git -C "$REMOTE" branch feature/x main
rm -f "$GH_OPEN_PR"
reset
CALIBRATION_BASE=feature/x CLAUDE_STUB_MODE=plan calibrate > "$WORK/calbranch" 2>&1 ||
  fail "a calibration of another branch should exit 0, got: $(cat "$WORK/calbranch")"
[ -z "$(branch_sha)" ] || fail "a calibration of another branch should not push supervisor/calibration"
git -C "$REMOTE" rev-parse --verify --quiet refs/heads/supervisor/calibration-feature-x > /dev/null ||
  fail "a calibration of feature/x should push supervisor/calibration-feature-x"
grep -q -- '--base feature/x --head supervisor/calibration-feature-x' "$GH_LOG" ||
  fail "a calibration of feature/x should open its PR from its own branch, got: $(cat "$GH_LOG")"

# Any other mode is refused before a secret is resolved.
reset
if SUPERVISOR_MODE=deploy bash "$DIR/supervisor.sh" > "$WORK/badmode" 2>&1; then
  fail "an unknown SUPERVISOR_MODE should fail"
fi
grep -q 'SUPERVISOR_MODE must be tick or calibrate, got: deploy' "$WORK/badmode" ||
  fail "an unknown mode should be named, got: $(cat "$WORK/badmode")"
[ ! -s "$PASS_ARGV_LOG" ] || fail "an unknown mode should resolve no secret"

echo "supervisor stub tests: ok"
