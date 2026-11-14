#!/usr/bin/env bash
# Starts the claude-shadow of this workspace: a persistent interactive Claude
# Code session, kept alive by a Herdr server whose session is named after the
# workspace (the toolbox's shadow_* tools talk to it, see toolbox/README.md).
# Run by the toolbox's workspace_up when called with shadow=true, from the
# workspace's checkout like the other bootstrap scripts, and safe to run again:
# it installs what is missing, starts the Herdr server only if its session is
# not running, and starts Claude only if no pane of that session runs it.
#
# What it never does: log Claude in. Remote Control needs the standard
# subscription login (`claude auth login`, done once by a person attached to
# the pane), not an injected CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, so
# both are unset for the Herdr server and for Claude. A workspace that is not
# logged in is left up and recorded as "needs-login" in
# ~/.shadow/<workspace>.json, which workspace_status reports.
#
# The login and the conversation live in $HOME, so $HOME must be a docker
# volume that outlives the container: toolbox/host.sh creates a shadow
# workspace from .devcontainer/shadow/devcontainer.json, which mounts
# <workspace>-home there. If $HOME is not a mount, this script says so in the
# state file's detail and carries on.
#
# SHADOW_SESSION_ID (optional, sent by the toolbox, remembered in
# ~/.shadow/<workspace>.session-id): the Claude session to resume. Without
# one, Claude starts a fresh session.
#
# Every Herdr, Claude and installer flag below was read from herdr.dev/llms.txt
# (v0.9.5) or `claude --help` (2.1.323) except where a comment says otherwise.
set -euo pipefail

# Pinned: the installer at herdr.dev/install.sh only installs the latest
# release, so this downloads the release asset itself and checks its SHA-256.
# The checksums are the "sha256" entries of https://herdr.dev/latest.json for
# 0.9.5 (the same file the official installer verifies against) and match the
# downloaded assets.
HERDR_VERSION=0.9.5
HERDR_SHA256_LINUX_X86_64=14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d
HERDR_SHA256_LINUX_AARCH64=17d7536f2da50859523680ef279dffcac8e4a235f4e46fe8da6c2ec44141897c

export PATH="$HOME/.local/bin:$PATH"

# The workspace id is the checkout's directory name: /workspaces/<id>.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WS=${SHADOW_WORKSPACE:-$(basename "$ROOT")}
if ! [[ $WS =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then
  echo "start-shadow: workspace name '$WS' is not a toolbox workspace name" >&2
  exit 1
fi

STATE_DIR=$HOME/.shadow
mkdir -p "$STATE_DIR"
STATE_FILE=$STATE_DIR/$WS.json
SESSION_FILE=$STATE_DIR/$WS.session-id
DETAIL=""

# One run at a time: two overlapping runs could both see no Claude pane.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/$WS.lock"
  flock -w 120 9 || { echo "start-shadow: another run holds the lock" >&2; exit 1; }
fi

command -v jq >/dev/null 2>&1 || { echo "start-shadow: jq is required" >&2; exit 1; }

# Records where this run got to. workspace_status reads it.
record() { # state [detail]
  jq -n --arg state "$1" --arg detail "${2:-$DETAIL}" --arg at "$(date -u +%FT%TZ)" \
    '{state: $state, detail: $detail, updated: $at}' > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
}
fail() { echo "start-shadow: $1" >&2; record failed "$1"; exit 1; }

# ---- Herdr, pinned and checksummed ------------------------------------------
if ! command -v herdr >/dev/null 2>&1; then
  case "$(uname -m)" in
    x86_64 | amd64) arch=x86_64 want=$HERDR_SHA256_LINUX_X86_64 ;;
    aarch64 | arm64) arch=aarch64 want=$HERDR_SHA256_LINUX_AARCH64 ;;
    *) fail "no Herdr release for $(uname -m)" ;;
  esac
  tmp=$(mktemp)
  curl -fsSL "https://github.com/herdrdev/herdr/releases/download/v$HERDR_VERSION/herdr-linux-$arch" -o "$tmp" || { rm -f "$tmp"; fail "could not download Herdr $HERDR_VERSION"; }
  got=$(sha256sum < "$tmp" | awk '{print $1}')
  if [ "$got" != "$want" ]; then
    rm -f "$tmp"
    fail "Herdr download checksum mismatch (got $got)"
  fi
  mkdir -p "$HOME/.local/bin"
  chmod +x "$tmp"
  mv "$tmp" "$HOME/.local/bin/herdr"
  echo "start-shadow: installed herdr $HERDR_VERSION"
elif [ "$(herdr --version)" != "herdr $HERDR_VERSION" ]; then
  # Not replaced: someone installed it on purpose, or herdr update ran.
  echo "start-shadow: herdr is $(herdr --version), the pinned version is $HERDR_VERSION; leaving it" >&2
fi

# ---- Claude Code: the same installer install-tools.sh uses -------------------
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | bash || fail "could not install Claude Code"
fi

# TODO: the Delta CLI and the Claude Delta plugin are not installed here. The
# only Delta CLI found is the one bundled in Delta.app on macOS
# (/Applications/Delta.app/Contents/MacOS/delta); no documented
# non-interactive Linux install or plugin install was found. Add it here once
# one exists, so the shadow can join Delta threads.

# ---- Does $HOME persist? ------------------------------------------------------
if ! awk -v h="$HOME" '$2 == h { found = 1 } END { exit !found }' /proc/mounts; then
  DETAIL="$HOME is not a mount: the Claude login and conversation are lost when the container is rebuilt (create the workspace with shadow=true so .devcontainer/shadow/devcontainer.json mounts ${WS}-home there)"
  echo "start-shadow: warning: $DETAIL" >&2
fi

# ---- Which session to resume --------------------------------------------------
SESSION_ID=${SHADOW_SESSION_ID:-}
if [ -n "$SESSION_ID" ]; then
  [[ $SESSION_ID =~ ^[0-9a-fA-F-]{36}$ ]] || fail "SHADOW_SESSION_ID is not a session UUID"
  printf '%s\n' "$SESSION_ID" > "$SESSION_FILE"
elif [ -s "$SESSION_FILE" ]; then
  SESSION_ID=$(head -n1 "$SESSION_FILE")
  [[ $SESSION_ID =~ ^[0-9a-fA-F-]{36}$ ]] || fail "$SESSION_FILE does not hold a session UUID"
fi

# ---- The Herdr server for this workspace -----------------------------------------
H() { herdr --session "$WS" "$@"; }
session_running() {
  herdr session list --json | jq -e --arg n "$WS" '.sessions[]? | select(.name == $n and .running)' >/dev/null
}

if session_running; then
  echo "start-shadow: herdr session $WS is already running"
else
  record starting "starting the herdr server"
  # The server's environment is every pane's: Claude must not see the tokens.
  # 9>&- keeps the lock's file descriptor from the long-lived server, which
  # would hold the lock for as long as it runs.
  env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY \
    setsid nohup herdr --session "$WS" server > "$STATE_DIR/$WS.server.log" 2>&1 < /dev/null 9>&- &
  for _ in $(seq 1 60); do
    session_running && break
    sleep 0.5
  done
  session_running || fail "the herdr server for session $WS did not come up (see $STATE_DIR/$WS.server.log)"
  echo "start-shadow: started herdr session $WS"
fi

# ---- A pane for Claude ----------------------------------------------------------
# Server restarts restore the layout as plain shells, so a pane with no agent in
# it is where Claude goes; there is exactly one pane, w1:p1 on a fresh session.
pane_json=$(H pane list)
pane=$(jq -r '.result.panes[0].pane_id // empty' <<< "$pane_json")
if [ -z "$pane" ]; then
  pane=$(H workspace create --cwd "$ROOT" --label "$WS" --no-focus | jq -r '.result.root_pane.pane_id // empty')
  [ -n "$pane" ] || fail "herdr workspace create returned no pane"
fi

claude_running() {
  # Two independent signals, either is enough. Herdr's agent label for a Claude
  # pane is "claude" (the agent kind name in the CLI reference; not confirmed
  # against a live Claude pane, and Herdr may not label Claude while it shows
  # its login screen), so a Claude process for this workspace counts as well.
  H pane list | jq -e --arg p "$pane" '.result.panes[] | select(.pane_id == $p and .agent == "claude")' >/dev/null 2>&1 ||
    pgrep -u "$(id -u)" -f -- "--remote-control $WS" >/dev/null 2>&1
}
# True only when the pane's foreground is nothing but shells, so typing a
# command into it cannot land in another program. `pane process-info --pane`
# lists the foreground processes (herdr pane process-info --help); if it cannot
# be read, the answer is no.
pane_is_idle_shell() {
  H pane process-info --pane "$pane" 2>/dev/null | jq -e '
    .result.process_info.foreground_processes
    | (length > 0) and all(.name | IN("bash", "zsh", "sh", "dash", "fish"))' >/dev/null 2>&1
}
login_state() { # true, false or unknown
  local out
  out=$(timeout 20 env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude auth status --json 2>/dev/null) || { echo unknown; return; }
  jq -r 'if has("loggedIn") then (.loggedIn | tostring) else "unknown" end' <<< "$out" 2>/dev/null || echo unknown
}

other=$(jq -r --arg p "$pane" '.result.panes[] | select(.pane_id == $p) | .agent // empty' <<< "$pane_json")
if claude_running; then
  echo "start-shadow: claude already runs in pane $pane"
elif [ -n "$other" ]; then
  fail "pane $pane runs $other, not claude; not touching it"
elif ! pane_is_idle_shell; then
  # Claude may be there under a label or process name not recognised above;
  # typing the launch command into it would reach it as a prompt.
  fail "pane $pane is not an idle shell and no claude for $WS was detected; not typing into it (see: herdr --session $WS pane read $pane)"
else
  if [ -n "$SESSION_ID" ]; then
    cmd="env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude --resume $SESSION_ID --remote-control $WS"
  else
    cmd="env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY claude --remote-control $WS"
  fi
  H pane run "$pane" "$cmd" > /dev/null
  echo "start-shadow: started claude in pane $pane"
  for _ in $(seq 1 90); do
    claude_running && break
    sleep 0.5
  done
fi

login=$(login_state)
if [ "$login" != true ]; then
  # Left up on purpose: attach and run /login there. Claude may not be
  # detected as an agent while it shows its login screen. "unknown" counts as
  # not logged in: in the first live run, a fresh Claude still in its first-run
  # setup gave no readable status, then loggedIn false.
  record needs-login "Claude is not logged in (status: $login): attach to the pane and log in (claude auth login); ${DETAIL}"
  echo "start-shadow: claude is not logged in ($login); recorded needs-login"
  exit 0
fi
claude_running || fail "claude was started in pane $pane but Herdr does not report it as an agent"
record running "$DETAIL"
echo "start-shadow: running (logged in: $login)"
