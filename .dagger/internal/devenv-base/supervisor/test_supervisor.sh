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
  fail) echo "boom" >&2; exit 3 ;;
  hang) exec sleep 60 ;;
esac
STUB

chmod +x "$BIN/pass-cli" "$BIN/restic" "$BIN/claude"

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

fail() { echo "FAIL: $*" >&2; exit 1; }

# A fresh container for each run: nothing from the last one is on disk.
reset() {
  rm -rf "$HOME" "$TMPDIR" "$CALLS" "$RESTIC_LOG" "$PASS_ENVFILE_LOG" "$PASS_ARGV_LOG" "$CLAUDE_ARGV" "$CLAUDE_PWD" "$CLAUDE_MCP" "$CLAUDE_MCP_MODE"
  mkdir -p "$HOME" "$TMPDIR"
  : > "$CALLS"
  : > "$RESTIC_LOG"
  : > "$PASS_ENVFILE_LOG"
  : > "$PASS_ARGV_LOG"
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

echo "supervisor stub tests: ok"
