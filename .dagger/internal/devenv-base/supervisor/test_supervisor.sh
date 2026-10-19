#!/usr/bin/env bash
# Runs supervisor.sh against a stubbed pass-cli and claude. No network, no
# credentials, no model: this checks the three properties the dry run is
# supposed to guarantee.
#
#   1. A run that reaches a decision passes, and the heartbeat is the last word.
#   2. A run that produces prose but no decision fails, as does one where
#      claude itself exits nonzero -- silence must not look like success.
#   3. The run is read-only by construction: the read tools are allowed, every
#      tool that can move infrastructure is disallowed by name, and the toolbox
#      bearer token reaches claude through a file rather than through argv.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
BIN=$WORK/bin
mkdir -p "$BIN"

cat > "$BIN/pass-cli" <<'STUB'
#!/usr/bin/env bash
# info: report a live session, so the script never attempts a login.
# run --env-file F -- cmd...: run the command, as the real one does once it
# has resolved the pass:// references.
case "${1:-}" in
  info) exit 0 ;;
  run)
    shift
    while [ $# -gt 0 ]; do
      if [ "$1" = "--" ]; then shift; break; fi
      shift
    done
    exec "$@"
    ;;
  *) exit 0 ;;
esac
STUB

cat > "$BIN/claude" <<'STUB'
#!/usr/bin/env bash
# Record argv (one argument per line) and the MCP config handed over, then
# behave as CLAUDE_STUB_MODE asks.
printf '%s\n' "$@" > "$CLAUDE_ARGV"
cfg="" prev=""
for a in "$@"; do
  [ "$prev" = "--mcp-config" ] && cfg=$a
  prev=$a
done
[ -z "$cfg" ] || cp "$cfg" "$CLAUDE_MCP"
case "${CLAUDE_STUB_MODE:-ok}" in
  ok)
    echo "The host is stopped and the next window is hours away."
    echo "SUPERVISOR_HEARTBEAT: zone=zone-test host=stopped work=no decision=nothing why=no window near"
    ;;
  prose) echo "I had a look around and it all seems fine." ;;
  fail) echo "boom" >&2; exit 3 ;;
esac
STUB

chmod +x "$BIN/pass-cli" "$BIN/claude"

export PATH="$BIN:$PATH"
export PROTON_PASS_PERSONAL_ACCESS_TOKEN=stub-pass-token
export TOOLBOX_TOKEN=stub-toolbox-token
export SUPERVISOR_ZONE=zone-test
export SUPERVISOR_TZ=Asia/Hong_Kong
export SUPERVISOR_TIMEOUT=2m
export CLAUDE_ARGV=$WORK/argv
export CLAUDE_MCP=$WORK/mcp.json

fail() { echo "FAIL: $*" >&2; exit 1; }

# Prints the arguments that followed $1, up to the next flag.
section() {
  awk -v flag="$1" 'BEGIN { on = 0 } $0 == flag { on = 1; next } /^--/ { on = 0 } on { print }' "$CLAUDE_ARGV"
}

CLAUDE_STUB_MODE=ok bash "$DIR/supervisor.sh" > "$WORK/out" ||
  fail "a run that reached a decision should exit 0"
tail -1 "$WORK/out" | grep -q '^SUPERVISOR_HEARTBEAT: zone=zone-test .*decision=nothing' ||
  fail "the heartbeat should be the last line of the run"

grep -q 'stub-toolbox-token' "$CLAUDE_MCP" ||
  fail "the MCP config should carry the toolbox bearer token"
if grep -q 'stub-toolbox-token' "$CLAUDE_ARGV"; then
  fail "the toolbox token must never appear in claude's argv"
fi
grep -qx -- '--strict-mcp-config' "$CLAUDE_ARGV" ||
  fail "--strict-mcp-config should be passed, so no other MCP server joins in"

for tool in mcp__toolbox__host_status mcp__toolbox__workspace_list mcp__toolbox__workspace_status; do
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

# A timezone the box does not know would silently become UTC, putting the
# window hours out while the run still looks healthy.
if SUPERVISOR_TZ=Not/AZone bash "$DIR/supervisor.sh" > "$WORK/badtz" 2>&1; then
  fail "an unknown timezone should fail the run"
fi
grep -q 'unknown timezone Not/AZone' "$WORK/badtz" ||
  fail "an unknown timezone should say so"

if CLAUDE_STUB_MODE=prose bash "$DIR/supervisor.sh" > "$WORK/prose" 2>&1; then
  fail "a run that produced no heartbeat should fail"
fi
grep -q 'no SUPERVISOR_HEARTBEAT line' "$WORK/prose" ||
  fail "a missing heartbeat should say so"

if CLAUDE_STUB_MODE=fail bash "$DIR/supervisor.sh" > "$WORK/broken" 2>&1; then
  fail "a run where claude exited nonzero should fail"
fi
grep -q 'claude exited 3' "$WORK/broken" ||
  fail "a failed claude run should report its exit status"

echo "supervisor stub tests: ok"
