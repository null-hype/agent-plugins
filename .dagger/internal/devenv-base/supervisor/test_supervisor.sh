#!/usr/bin/env bash
# Runs supervisor.sh against stubbed pass-cli, restic and claude. No network,
# no credentials, no model: this checks what a zone's run is supposed to
# guarantee.
#
#   1. The session is restored, then resumed, then backed up -- in that order,
#      resuming the zone's own session id with Remote Control on.
#   2. The backup happens after a failing or timed-out claude too, so the next
#      run remembers the failure; and a missing snapshot fails the run before
#      claude is started at all.
#   3. A run that reaches a decision passes, with the heartbeat as the last
#      word. One that produces prose but no decision fails, as does one where
#      claude itself exits nonzero -- silence must not look like success.
#   4. The run cannot move infrastructure: the read tools and Linear are
#      allowed, every toolbox tool that can move infrastructure is disallowed
#      by name, and the bearer tokens reach claude through a 0600 file rather
#      than through argv.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BIN=$WORK/bin
mkdir -p "$BIN"

cat > "$BIN/pass-cli" <<'STUB'
#!/usr/bin/env bash
# info: report a live session, so the script never attempts a login.
# run --env-file F -- cmd...: resolve each KEY=pass://vault/item/NAME line to
# "resolved-NAME" -- so the value shows which pass item it came from -- and
# run the command with them, as the real one does.
case "${1:-}" in
  info) exit 0 ;;
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
# RESTIC_STUB_FIND asks. restore plants the transcript where Claude keeps it.
echo "restic $1" >> "$CALLS"
echo "restic $* (cwd=$PWD)" >> "$RESTIC_LOG"
case "$1" in
  find)
    if [ "${RESTIC_STUB_FIND:-hit}" = hit ]; then
      echo '[{"snapshot":"old","matches":[{"mtime":"2026-10-18T00:00:00Z"}]},{"snapshot":"snap-new","matches":[{"mtime":"2026-10-19T00:00:00Z"}]}]'
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
    mkdir -p "$target/.claude/projects/-app" "$target/.claude/backups"
    echo '{}' > "$target/.claude/projects/-app/$RESTIC_STUB_SESSION.jsonl"
    echo '{"account":"stub"}' > "$target/.claude/backups/.claude.json.backup.1"
    ;;
  backup) ;;
esac
STUB

cat > "$BIN/claude" <<'STUB'
#!/usr/bin/env bash
# Record argv (one argument per line) and the MCP config handed over, then
# behave as CLAUDE_STUB_MODE asks.
echo "claude" >> "$CALLS"
printf '%s\n' "$@" > "$CLAUDE_ARGV"
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
    echo "The host is stopped and the next window is hours away."
    echo "SUPERVISOR_HEARTBEAT: zone=zone-test host=stopped work=no decision=nothing why=no window near"
    ;;
  prose) echo "I had a look around and it all seems fine." ;;
  fail) echo "boom" >&2; exit 3 ;;
  hang) exec sleep 60 ;;
esac
STUB

chmod +x "$BIN/pass-cli" "$BIN/restic" "$BIN/claude"

export PATH="$BIN:$PATH"
export HOME=$WORK/home
mkdir -p "$HOME"
export PROTON_PASS_PERSONAL_ACCESS_TOKEN=stub-pass-token
export TOOLBOX_TOKEN=stub-toolbox-token
export SUPERVISOR_ZONE=zone-test
export SUPERVISOR_TZ=Asia/Hong_Kong
export SUPERVISOR_TIMEOUT=2m
# The default effort is what the first run asserts, wherever the test runs.
unset SUPERVISOR_EFFORT
export CALLS=$WORK/calls
export RESTIC_LOG=$WORK/restic.log
export CLAUDE_ARGV=$WORK/argv
export CLAUDE_MCP=$WORK/mcp.json
export CLAUDE_MCP_MODE=$WORK/mcp.mode
# What the stub pass-cli resolves the zone's own session id reference to.
SESSION=resolved-SUPERVISOR_SESSION_ID_ZONE_TEST
export RESTIC_STUB_SESSION=$SESSION

fail() { echo "FAIL: $*" >&2; exit 1; }

# A fresh container for each run: nothing from the last one is on disk.
reset() {
  rm -rf "$HOME" "$CALLS" "$RESTIC_LOG" "$CLAUDE_ARGV" "$CLAUDE_MCP" "$CLAUDE_MCP_MODE"
  mkdir -p "$HOME"
  : > "$CALLS"
  : > "$RESTIC_LOG"
}

# Prints the arguments that followed $1, up to the next flag.
section() {
  awk -v flag="$1" 'BEGIN { on = 0 } $0 == flag { on = 1; next } /^--/ { on = 0 } on { print }' "$CLAUDE_ARGV"
}

# Prints the one argument right after $1.
after() {
  awk -v flag="$1" 'found { print; exit } $0 == flag { found = 1 }' "$CLAUDE_ARGV"
}

calls() { paste -sd' ' "$CALLS"; }

# --- a run that reaches a decision ------------------------------------------

reset
CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > "$WORK/out" ||
  fail "a run that reached a decision should exit 0"
tail -1 "$WORK/out" | grep -q '^SUPERVISOR_HEARTBEAT: zone=zone-test .*decision=nothing' ||
  fail "the heartbeat should be the last line of the run"

[ "$(calls)" = "restic find restic restore claude restic backup" ] ||
  fail "expected restore, then resume, then backup; got: $(calls)"

# The restore: the newest snapshot holding the session under the zone's tag,
# without the daemon's runtime state.
grep -q -- "find .*--tag supervisor-zone-test .*$SESSION.jsonl" "$RESTIC_LOG" ||
  fail "the restic find should look for the zone's session under the zone's tag"
grep -q -- 'restore snap-new --target '"$HOME"' --exclude /.claude/daemon\* --exclude /.claude/jobs' "$RESTIC_LOG" ||
  fail "the restore should take the newest snapshot that holds the session, minus daemon and jobs"
[ -s "$HOME/.claude.json" ] ||
  fail "a missing ~/.claude.json should be restored from Claude's backups"

# The resume: the zone's own session, Remote Control on, in the foreground.
[ "$(after --resume)" = "$SESSION" ] ||
  fail "claude should resume the zone's session id, got: $(after --resume)"
grep -qx -- '--remote-control' "$CLAUDE_ARGV" ||
  fail "--remote-control should be passed"
[ "$(section --effort)" = low ] ||
  fail "--effort low should be passed when SUPERVISOR_EFFORT is unset, got: $(section --effort)"
grep -qx -- '-p' "$CLAUDE_ARGV" ||
  fail "the resume should run in the foreground with -p"
if grep -qx -- '--bg' "$CLAUDE_ARGV"; then
  fail "--bg would end with the Render container; the resume must stay in the foreground"
fi
grep -q 'dispatch issue' "$CLAUDE_ARGV" ||
  fail "the prompt should tell the session to work the dispatch issue"
grep -q 'zone-test' "$CLAUDE_ARGV" ||
  fail "the prompt should name the zone"

# The backup: from $HOME, relative, so the snapshot restores with the same
# --target and --exclude the restore uses.
grep -q -- "backup .claude --tag supervisor-zone-test (cwd=$HOME)" "$RESTIC_LOG" ||
  fail "the backup should run from \$HOME on the relative path .claude, under the zone's tag"

# --- the tools ---------------------------------------------------------------

grep -q 'stub-toolbox-token' "$CLAUDE_MCP" ||
  fail "the MCP config should carry the toolbox bearer token"
grep -q 'resolved-LINEAR_API_KEY' "$CLAUDE_MCP" ||
  fail "the MCP config should carry the Linear key"
[ "$(jq -r '.mcpServers.linear.url' "$CLAUDE_MCP")" = "https://mcp.linear.app/mcp" ] ||
  fail "Linear should be an explicit MCP server: --strict-mcp-config leaves no connector to rely on"
[ "$(cat "$CLAUDE_MCP_MODE")" = 600 ] ||
  fail "the MCP config holds bearer tokens and should be mode 0600, got $(cat "$CLAUDE_MCP_MODE")"
for secret in stub-toolbox-token resolved-LINEAR_API_KEY resolved-CLAUDE_CODE_OAUTH_TOKEN resolved-RESTIC_PASSWORD; do
  if grep -q "$secret" "$CLAUDE_ARGV"; then
    fail "$secret must never appear in claude's argv"
  fi
done
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

# The window is decided from the team's own clock, and the numbers are
# handed over rather than left to the model to derive.
grep -q 'Asia/Hong_Kong' "$CLAUDE_ARGV" ||
  fail "the prompt should name the team's timezone"
grep -qE 'Minutes until the team.s next local midnight: \*\*-?[0-9]+\*\*' "$CLAUDE_ARGV" ||
  fail "the prompt should carry the minutes to local midnight, already computed"
if grep -q '{{' "$CLAUDE_ARGV"; then
  fail "every prompt placeholder should have been substituted"
fi

# A different zone resumes a different session: the id comes from the zone's
# own pass item, not from anything shared.
reset
RESTIC_STUB_SESSION=resolved-SUPERVISOR_SESSION_ID_OTHER_ZONE_X \
  SUPERVISOR_ZONE=other-zone-x CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > /dev/null ||
  fail "another zone's run should pass too"
[ "$(after --resume)" = "resolved-SUPERVISOR_SESSION_ID_OTHER_ZONE_X" ] ||
  fail "another zone should resume its own session id, got: $(after --resume)"

# SUPERVISOR_EFFORT overrides the default, and is passed explicitly all the
# same.
reset
SUPERVISOR_EFFORT=high CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > /dev/null ||
  fail "a run with SUPERVISOR_EFFORT set should pass"
[ "$(section --effort)" = high ] ||
  fail "SUPERVISOR_EFFORT should be passed through, got: $(section --effort)"

# --- the restore fails -------------------------------------------------------

# No snapshot holds the session: fail loudly, and do not resume a session
# that is not there (or back up an empty ~/.claude over the real one).
reset
if RESTIC_STUB_FIND=miss bash "$DIR/supervisor.sh" > "$WORK/nosnap" 2>&1; then
  fail "a missing snapshot should fail the run"
fi
grep -q "no snapshot tagged supervisor-zone-test holds session $SESSION" "$WORK/nosnap" ||
  fail "a missing snapshot should say which session and tag it looked for"
[ "$(calls)" = "restic find" ] ||
  fail "with no snapshot neither claude nor a backup should run; got: $(calls)"

# --- claude fails ------------------------------------------------------------

reset
if CLAUDE_STUB_MODE=fail bash "$DIR/supervisor.sh" > "$WORK/broken" 2>&1; then
  fail "a run where claude exited nonzero should fail"
fi
grep -q 'claude exited 3' "$WORK/broken" ||
  fail "a failed claude run should report its exit status"
[ "$(calls)" = "restic find restic restore claude restic backup" ] ||
  fail "the backup should run after a failing claude; got: $(calls)"

reset
if CLAUDE_STUB_MODE=hang SUPERVISOR_CLAUDE_TIMEOUT=1s bash "$DIR/supervisor.sh" > "$WORK/hung" 2>&1; then
  fail "a claude that outlives its wall-clock timeout should fail the run"
fi
grep -q 'claude timed out after 1s' "$WORK/hung" ||
  fail "a timed-out claude should say so"
[ "$(calls)" = "restic find restic restore claude restic backup" ] ||
  fail "the backup should run after a timed-out claude; got: $(calls)"

reset
if CLAUDE_STUB_MODE=prose bash "$DIR/supervisor.sh" > "$WORK/prose" 2>&1; then
  fail "a run that produced no heartbeat should fail"
fi
grep -q 'no SUPERVISOR_HEARTBEAT line' "$WORK/prose" ||
  fail "a missing heartbeat should say so"
[ "$(calls)" = "restic find restic restore claude restic backup" ] ||
  fail "the transcript of a run without a heartbeat should still be backed up; got: $(calls)"

# --- refusals before anything runs -------------------------------------------

# A timezone the box does not know would silently become UTC, putting the
# window hours out while the run still looks healthy.
reset
if SUPERVISOR_TZ=Not/AZone bash "$DIR/supervisor.sh" > "$WORK/badtz" 2>&1; then
  fail "an unknown timezone should fail the run"
fi
grep -q 'unknown timezone Not/AZone' "$WORK/badtz" ||
  fail "an unknown timezone should say so"

# The zone names a pass item and a restic tag, so it has to be a plain slug.
reset
if SUPERVISOR_ZONE='Zone Test' bash "$DIR/supervisor.sh" > "$WORK/badzone" 2>&1; then
  fail "a zone that is not a plain slug should fail the run"
fi
[ ! -s "$CALLS" ] || fail "nothing should run for a bad zone; got: $(calls)"

echo "supervisor stub tests: ok"
