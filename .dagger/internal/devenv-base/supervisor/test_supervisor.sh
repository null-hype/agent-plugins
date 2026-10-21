#!/usr/bin/env bash
# Runs supervisor.sh against stubbed pass-cli, restic and claude. No network,
# no credentials, no model: this checks what a tick is supposed to guarantee.
#
#   1. There is one hourly service, `supervisor`, on `13 * * * *`.
#   2. The session is restored from the newest snapshot tagged `supervisor`,
#      continued with `claude --continue` from /workspaces/agent-plugins, then
#      backed up -- in that order. No session id and no zone is read anywhere.
#   3. The backup happens after a failing or timed-out claude too, so the next
#      tick remembers the failure; and a missing snapshot, or one without a
#      session in the working directory, fails the run before claude starts.
#   4. A run that reaches a decision passes, with the heartbeat as the last
#      word -- including the tick where no dispatch issue is open. One that
#      produces prose but no decision fails, as does one missing a hat's pass
#      line or one where claude itself exits nonzero -- silence must not look
#      like success.
#   5. The prompt has the session wear planning, infra and open source in
#      that order, hand off through Linear issues in Triage, and carries no
#      midnight, timezone or zone framing.
#   6. The run cannot move infrastructure: the read tools and Linear are
#      allowed, every toolbox tool that can move infrastructure is disallowed
#      by name, and the bearer tokens reach claude through a 0600 file rather
#      than through argv.
#   7. Every secret, the toolbox token included, is resolved by `pass-cli run`
#      from pass:// references; the Render service holds only the pass token.
#      With no pass session, or no pass token, nothing runs. No secret is on
#      an argv or left in a file once the run ends.
#   8. A calibration (SUPERVISOR_MODE=calibrate, CIT-472) is the planning
#      hat: it builds the workflow from a clone, runs the plan task on
#      `render workflows dev`, then runs planning fresh and read-only (it can
#      read Linear but every Linear write is denied, and it never touches
#      restic). Its changeset renders through the real pkl/Changeset.pkl with
#      `seen` filled in by the run, and apply is dry-run on the dev server
#      against that tree. A green calibration pushes changeset.pkl and
#      changeset.json to its own branch and opens one PR, and calls nothing
#      that deploys; an unchanged changeset pushes nothing. A changeset that
#      does not render, a missing changeset, a failed dry run, a missing
#      plan or dev server: each opens no PR.
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
    ;;
  backup) ;;
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
  ok)
    echo "SUPERVISOR_PASS: hat=planning handoffs=CIT-500 why=accepted one finding"
    echo "SUPERVISOR_PASS: hat=infra handoffs=none why=nothing accepted to ship"
    echo "SUPERVISOR_PASS: hat=open-source handoffs=none why=no release due"
    echo "The host is stopped and nothing is due."
    echo "SUPERVISOR_HEARTBEAT: host=stopped work=no decision=nothing why=nothing due"
    ;;
  nodispatch)
    echo "No open issue is titled Dispatch: anything."
    for hat in planning infra open-source; do
      echo "SUPERVISOR_PASS: hat=$hat handoffs=none why=no dispatch issue"
    done
    echo "SUPERVISOR_HEARTBEAT: host=unknown work=unknown decision=nothing why=no dispatch issue"
    ;;
  prose) echo "I had a look around and it all seems fine." ;;
  skipped)
    echo "SUPERVISOR_PASS: hat=planning handoffs=none why=triage empty"
    echo "SUPERVISOR_PASS: hat=open-source handoffs=none why=no release due"
    echo "SUPERVISOR_HEARTBEAT: host=stopped work=no decision=nothing why=nothing due"
    ;;
  plan | badpkl)
    hat=infra
    [ "$CLAUDE_STUB_MODE" = plan ] || hat=planning
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
# Only the dev server's readiness probe uses curl.
[ "${CURL_STUB:-up}" = up ]
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
  "pr list") [ ! -s "$GH_OPEN_PR" ] || cat "$GH_OPEN_PR" ;;
  "pr create")
    prev=""
    for a in "$@"; do
      [ "$prev" = "--body-file" ] && cp "$a" "$GH_PR_BODY"
      prev=$a
    done
    echo "https://github.com/null-hype/agent-plugins/pull/999" | tee "$GH_OPEN_PR"
    ;;
esac
STUB

chmod +x "$BIN/pass-cli" "$BIN/restic" "$BIN/claude" "$BIN/render" "$BIN/curl" "$BIN/npm" "$BIN/node" "$BIN/gh"

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
unset SUPERVISOR_ZONE SUPERVISOR_SESSION_ID SUPERVISOR_TZ SUPERVISOR_EFFORT
export CALLS=$WORK/calls
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

# --- a run that reaches a decision -------------------------------------------

reset
CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > "$WORK/out" ||
  fail "a run that reached a decision should exit 0"
tail -1 "$WORK/out" | grep -q '^SUPERVISOR_HEARTBEAT: host=.*decision=nothing' ||
  fail "the heartbeat should be the last line of the run"

[ "$(calls)" = "restic snapshots restic restore claude restic backup" ] ||
  fail "expected restore, then continue, then backup; got: $(calls)"

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
[ "$(section --effort)" = low ] ||
  fail "--effort low should be passed when SUPERVISOR_EFFORT is unset, got: $(section --effort)"
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

grep -q 'Dispatch: <hat>' "$CLAUDE_ARGV" ||
  fail "the prompt should say which issues to work: those titled Dispatch: <hat>"
grep -q 'in this order: planning, infra, open source' "$CLAUDE_ARGV" ||
  fail "the prompt should run the planning, infra and open source passes in that order"
grep -q 'SUPERVISOR_PASS: hat=<planning|infra|open-source> handoffs=' "$CLAUDE_ARGV" ||
  fail "the prompt should give the pass line format"
grep -q 'new issue in Triage' "$CLAUDE_ARGV" ||
  fail "the prompt should make a handoff a new issue in Triage"
grep -q 'State.*Evidence.*Next step.*Open questions.*Resume' "$CLAUDE_ARGV" ||
  fail "the prompt should give the handoff's sections in order"
grep -q 'only planning may' "$CLAUDE_ARGV" ||
  fail "the prompt should leave moving issues out of Triage to planning alone"
grep -q "description says" "$CLAUDE_ARGV" ||
  fail "the prompt should tell the session to do what each description says"
grep -q 'decision=nothing why=no dispatch issue' "$CLAUDE_ARGV" ||
  fail "the prompt should give the heartbeat for a tick with no dispatch issue"
grep -qE 'Now, UTC: \*\*[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the current UTC time"
grep -q 'SUPERVISOR_HEARTBEAT: host=' "$CLAUDE_ARGV" ||
  fail "the prompt should end with the heartbeat format"
if grep -q '{{' "$CLAUDE_ARGV"; then
  fail "every prompt placeholder should have been substituted"
fi
if grep -qiE 'midnight|timezone|zone' "$CLAUDE_ARGV"; then
  fail "the prompt should carry no midnight, timezone or zone framing"
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
for secret in resolved-TOOLBOX_TOKEN resolved-LINEAR_API_KEY resolved-CLAUDE_CODE_OAUTH_TOKEN resolved-RESTIC_PASSWORD; do
  if grep -q "$secret" "$CLAUDE_ARGV"; then
    fail "$secret must never appear in claude's argv"
  fi
  if grep -q "$secret" "$PASS_ARGV_LOG" "$RESTIC_LOG"; then
    fail "$secret must never appear in the argv of pass-cli or restic"
  fi
  if grep -rq "$secret" "$HOME" "$TMPDIR"; then
    fail "$secret must not be left in a file once the run has ended"
  fi
done
[ -z "$(ls -A "$TMPDIR")" ] ||
  fail "the 0600 MCP and key files should be removed on exit, left: $(ls "$TMPDIR")"

# The toolbox token is resolved by pass-cli run from supervisor.env, and the
# Render service is not asked to carry it.
grep -qx 'TOOLBOX_TOKEN=pass://infra/render.com/TOOLBOX_TOKEN' "$PASS_ENVFILE_LOG" ||
  fail "the env file handed to pass-cli run should reference the toolbox token in Proton Pass"
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

for tool in mcp__toolbox__host_status mcp__toolbox__workspace_list mcp__toolbox__workspace_status mcp__linear; do
  section --allowedTools | grep -qx "$tool" || fail "$tool should be allowed"
done

for tool in mcp__toolbox__host_start mcp__toolbox__host_stop mcp__toolbox__agent_start \
  mcp__toolbox__workspace_delete mcp__toolbox__codespace_rebuild Bash Write Edit; do
  if section --allowedTools | grep -qx "$tool"; then
    fail "$tool must not be in the allowed list"
  fi
  section --disallowedTools | grep -qx "$tool" ||
    fail "$tool should be disallowed by name as well"
done

# --- settings the old per-zone services carried are ignored ------------------

reset
SUPERVISOR_ZONE=infrastructure SUPERVISOR_TZ=Asia/Hong_Kong SUPERVISOR_SESSION_ID=bogus-session \
  CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > /dev/null ||
  fail "a run with leftover zone settings should still pass"
if grep -q 'bogus-session' "$CLAUDE_ARGV" || grep -q 'infrastructure' "$RESTIC_LOG"; then
  fail "a leftover zone or session id must not reach claude or restic"
fi
grep -q -- 'backup .claude --tag supervisor (cwd=' "$RESTIC_LOG" ||
  fail "a leftover zone must not change the restic tag"

# SUPERVISOR_EFFORT overrides the default, and is passed explicitly all the
# same.
reset
SUPERVISOR_EFFORT=high CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > /dev/null ||
  fail "a run with SUPERVISOR_EFFORT set should pass"
[ "$(section --effort)" = high ] ||
  fail "SUPERVISOR_EFFORT should be passed through, got: $(section --effort)"

# --- no dispatch issue is open -----------------------------------------------

# The model says so in the heartbeat and the tick passes: it is a decision,
# not a broken instrument. The transcript is still backed up.
reset
CLAUDE_STUB_MODE=nodispatch bash "$DIR/supervisor.sh" > "$WORK/nodispatch" ||
  fail "a tick with no open dispatch issue should exit 0"
tail -1 "$WORK/nodispatch" | grep -qx 'SUPERVISOR_HEARTBEAT: host=unknown work=unknown decision=nothing why=no dispatch issue' ||
  fail "a tick with no open dispatch issue should end with its heartbeat, got: $(tail -1 "$WORK/nodispatch")"
[ "$(calls)" = "restic snapshots restic restore claude restic backup" ] ||
  fail "a tick with no dispatch issue should still be restored and backed up; got: $(calls)"

# --- there is no Proton Pass session -----------------------------------------

# Every secret, the toolbox token among them, comes through pass-cli, so with
# no session and a login that fails nothing may run: not the restore, not
# claude, not a backup.
reset
if PASS_STUB_SESSION=none bash "$DIR/supervisor.sh" > "$WORK/nopass" 2>&1; then
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
reset
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
reset
if RESTIC_STUB_SNAPSHOTS=miss bash "$DIR/supervisor.sh" > "$WORK/nosnap" 2>&1; then
  fail "a missing snapshot should fail the run"
fi
grep -q 'no snapshot tagged supervisor' "$WORK/nosnap" ||
  fail "a missing snapshot should say which tag it looked for"
[ "$(calls)" = "restic snapshots" ] ||
  fail "with no snapshot neither claude nor a backup should run; got: $(calls)"

# A snapshot with no session for /workspaces/agent-plugins would have
# --continue start a fresh, amnesiac one: refuse before claude runs.
reset
if RESTIC_STUB_RESTORE=elsewhere bash "$DIR/supervisor.sh" > "$WORK/nosession" 2>&1; then
  fail "a snapshot without a session for the working directory should fail the run"
fi
grep -q 'did not produce a session for /workspaces/agent-plugins' "$WORK/nosession" ||
  fail "a snapshot without the session should say which directory it expected"
[ "$(calls)" = "restic snapshots restic restore" ] ||
  fail "without the session neither claude nor a backup should run; got: $(calls)"

# --- claude fails ------------------------------------------------------------

reset
if CLAUDE_STUB_MODE=fail bash "$DIR/supervisor.sh" > "$WORK/broken" 2>&1; then
  fail "a run where claude exited nonzero should fail"
fi
grep -q 'claude exited 3' "$WORK/broken" ||
  fail "a failed claude run should report its exit status"
[ "$(calls)" = "restic snapshots restic restore claude restic backup" ] ||
  fail "the backup should run after a failing claude; got: $(calls)"

reset
if CLAUDE_STUB_MODE=hang SUPERVISOR_CLAUDE_TIMEOUT=1s bash "$DIR/supervisor.sh" > "$WORK/hung" 2>&1; then
  fail "a claude that outlives its wall-clock timeout should fail the run"
fi
grep -q 'claude timed out after 1s' "$WORK/hung" ||
  fail "a timed-out claude should say so"
[ "$(calls)" = "restic snapshots restic restore claude restic backup" ] ||
  fail "the backup should run after a timed-out claude; got: $(calls)"

reset
if CLAUDE_STUB_MODE=prose bash "$DIR/supervisor.sh" > "$WORK/prose" 2>&1; then
  fail "a run that produced no heartbeat should fail"
fi
grep -q 'no SUPERVISOR_HEARTBEAT line' "$WORK/prose" ||
  fail "a missing heartbeat should say so"
[ "$(calls)" = "restic snapshots restic restore claude restic backup" ] ||
  fail "the transcript of a run without a heartbeat should still be backed up; got: $(calls)"

# A heartbeat is not enough: a hat that never reported its pass handed
# nothing on, and the next pass has nothing to read.
reset
if CLAUDE_STUB_MODE=skipped bash "$DIR/supervisor.sh" > "$WORK/skipped" 2>&1; then
  fail "a run missing a hat's pass line should fail"
fi
grep -q 'expected SUPERVISOR_PASS lines for planning, infra and open-source in that order, got: planning open-source' "$WORK/skipped" ||
  fail "a missing pass line should name the hats it saw, got: $(cat "$WORK/skipped")"
[ "$(calls)" = "restic snapshots restic restore claude restic backup" ] ||
  fail "the transcript of a run missing a pass should still be backed up; got: $(calls)"

# --- calibration (CIT-472) ---------------------------------------------------

# The changeset is rendered by the real pkl against the real schema.
command -v pkl > /dev/null || fail "pkl must be on PATH: calibration renders the changeset with it"
SCHEMA=$DIR/../workflow/pkl/Changeset.pkl
[ -f "$SCHEMA" ] || fail "the changeset schema should be at $SCHEMA"

# The repo a calibration clones and pushes to: a bare repo whose main carries
# the workflow and its schema, so git itself is real and the pushed branch
# can be read back.
export GIT_AUTHOR_NAME=stub GIT_AUTHOR_EMAIL=stub@example.com
export GIT_COMMITTER_NAME=stub GIT_COMMITTER_EMAIL=stub@example.com
REMOTE=$WORK/remote.git
git init --quiet --bare --initial-branch=main "$REMOTE"
seed=$WORK/seed
WF=.dagger/internal/devenv-base/workflow
git init --quiet --initial-branch=main "$seed"
mkdir -p "$seed/$WF/pkl"
echo '{}' > "$seed/$WF/package.json"
cp "$SCHEMA" "$seed/$WF/pkl/Changeset.pkl"
git -C "$seed" add . && git -C "$seed" commit --quiet -m seed
git -C "$seed" push --quiet "$REMOTE" main
BASE_SHA=$(git -C "$seed" rev-parse HEAD)

calibrate() {
  SUPERVISOR_MODE=calibrate CALIBRATION_REMOTE=$REMOTE bash "$DIR/supervisor.sh" "$@"
}
branch_sha() { git -C "$REMOTE" rev-parse --verify --quiet refs/heads/supervisor/calibration || true; }
no_pr() { [ -z "$(branch_sha)" ] && ! grep -q 'pr create' "$GH_LOG"; }

# A green calibration.
reset
rm -f "$GH_OPEN_PR"
CLAUDE_STUB_MODE=plan calibrate > "$WORK/cal" 2>&1 ||
  fail "a green calibration should exit 0, got: $(cat "$WORK/cal")"
tail -1 "$WORK/cal" | grep -qx 'SUPERVISOR_CHANGESET: ops=5 clusters=1' ||
  fail "a calibration should end with its changeset summary, got: $(tail -1 "$WORK/cal")"
[ "$(calls)" = "render node plan claude node apply gh gh" ] ||
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
grep -q "You are the supervisor's \*\*planning hat\*\*" "$CLAUDE_ARGV" ||
  fail "the prompt should be planning.md"
grep -q '"pruned": \[' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the frozen plan"
if grep -q '"seen"' "$CLAUDE_ARGV"; then
  fail "the prompt should leave out the plan's seen: the run fills it in"
fi
if grep -q 'in this order: planning, infra, open source' "$CLAUDE_ARGV"; then
  fail "calibration is planning alone, not the tick's three passes"
fi
if grep -q '{{' "$CLAUDE_ARGV"; then
  fail "every calibration prompt placeholder should have been substituted"
fi

# Planning makes no Linear writes: it may read Linear, every tool that
# writes is denied, and Linear is not allowed as a whole.
if section --allowedTools | grep -qx mcp__linear; then
  fail "a calibration must not allow the Linear server as a whole"
fi
for tool in mcp__linear__list_issues mcp__linear__get_issue mcp__linear__list_comments mcp__toolbox__host_status; do
  section --allowedTools | grep -qx "$tool" || fail "$tool should be allowed in a calibration"
done
if section --allowedTools | grep -E '^mcp__linear__(save|create|delete|update|merge|submit|resolve|share|unshare|mark)_'; then
  fail "a calibration must not allow a Linear tool that writes"
fi
for tool in mcp__linear__save_issue mcp__linear__save_comment mcp__linear__delete_comment \
  mcp__linear__create_issue_label mcp__toolbox__host_start Bash; do
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
grep -qx 'gh pr create --repo null-hype/agent-plugins --base main --head supervisor/calibration --title Supervisor calibration: planning'"'"'s changeset --body-file .*' "$GH_LOG" ||
  fail "a green calibration should open a PR from supervisor/calibration into main, got: $(cat "$GH_LOG")"
grep -q 'Merging this applies it' "$GH_PR_BODY" && grep -qx '| delegate | new:review-findings | to tidelands-agent |' "$GH_PR_BODY" ||
  fail "the PR body should say merging applies it and list the dry run's ops, got: $(cat "$GH_PR_BODY")"
grep -q 'calibration PR https://github.com/null-hype/agent-plugins/pull/999' "$WORK/cal" ||
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

# A changeset that does not type-check never reaches the dry run or a PR.
git -C "$REMOTE" update-ref -d refs/heads/supervisor/calibration
rm -f "$GH_OPEN_PR"
reset
if CLAUDE_STUB_MODE=badpkl calibrate > "$WORK/calbad" 2>&1; then
  fail "a changeset that does not render should fail the calibration"
fi
grep -q 'the changeset does not render through pkl/Changeset.pkl' "$WORK/calbad" ||
  fail "a changeset that does not render should say so, got: $(cat "$WORK/calbad")"
[ "$(calls)" = "render node plan claude" ] && no_pr ||
  fail "a changeset that does not render should not be dry-run, pushed or opened; got: $(calls)"

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
grep -q 'claude exited 3 -- this calibrate has no decision' "$WORK/calfail" ||
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

# Any other mode is refused before a secret is resolved.
reset
if SUPERVISOR_MODE=deploy bash "$DIR/supervisor.sh" > "$WORK/badmode" 2>&1; then
  fail "an unknown SUPERVISOR_MODE should fail"
fi
grep -q 'SUPERVISOR_MODE must be tick or calibrate, got: deploy' "$WORK/badmode" ||
  fail "an unknown mode should be named, got: $(cat "$WORK/badmode")"
[ ! -s "$PASS_ARGV_LOG" ] || fail "an unknown mode should resolve no secret"

echo "supervisor stub tests: ok"
