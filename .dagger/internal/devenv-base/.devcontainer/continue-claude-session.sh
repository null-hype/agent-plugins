#!/usr/bin/env bash
# Resumes a dedicated, purpose-built Claude Code session on this devpod and
# lets it take one more turn, driven by devpod-keepalive.sh (see its call
# site). This is NOT "whatever session happens to be most recent" -- it's
# one specific session, created once by seeding it with the actual task
# ("look at my linear workspace, and assign issues or respond to feedback"),
# identified by a fixed UUID below. `claude --continue` (cwd-scoped "most
# recent session here") was tried first and rejected: linear-agent runs its
# own per-issue Claude Agent SDK sessions in this same cwd
# (/workspaces/devenv-base-gce, see linear-agent/src/claude.ts), so any
# webhook event between cron ticks would become "most recent" and hijack
# the next tick onto a random per-issue session instead of this one.
#
# `--resume <uuid>` was verified empirically (live test, both on a single
# host and cross-host) to find a session purely by UUID, independent of the
# cwd it's invoked from, and to keep appending to that session's *original*
# project folder regardless of where it's resumed. That's what makes the
# restic round-trip below work at all: this session's jsonl currently lives
# under the project folder for the machine it was created on
# (/home/vscode/cron-sessions/linear-keepalive), NOT
# /workspaces/devenv-base-gce -- that's fine and expected, don't "fix" it by
# trying to relocate/rename the file, `--resume` doesn't care.
#
# Backs ~/.claude up to the shared restic repo before and after the turn --
# disaster recovery only. This box's disk is the live, authoritative copy
# of the session the whole time; restic here just means a lost/rebuilt GCE
# instance doesn't also lose the conversation. Separate tag from the
# ~/.devpod client-state snapshots gce-common.sh already takes (see
# gce_common_restic_{pull,push}_claude_session below them), same shared
# repo.
#
# Runs in $PWD as left by `devpod ssh` (the workspace checkout,
# /workspaces/devenv-base-gce per devcontainer.json) -- irrelevant to which
# session gets resumed (see above), but still the right cwd for the turn
# itself to act from.
#
# CLAUDE_SESSION_ID and CLAUDE_MAX_BUDGET_USD are pulled from the pass-cli
# env file below (pass://tidelands.dev/claude/...), not forwarded in via
# `devpod ssh --set-env` from the caller. Neither is a secret, but pass-cli
# is this deployment's one config/secret path end to end (same as
# CLAUDE_CODE_OAUTH_TOKEN, RESTIC_*) -- routing them in a second way through
# the SSH invocation just for these two was an inconsistency, not a need.
set -euo pipefail

LIB_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/gce-common.sh"
export LIB_FILE

export PROTON_PASS_KEY_PROVIDER=${PROTON_PASS_KEY_PROVIDER:-fs}
export PROTON_PASS_AGENT_REASON="continue-claude-session: fetch restic + claude credentials"

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/continue-claude-session.env"

pass-cli run --env-file "$ENV_FILE" -- bash -c '
  set -euo pipefail
  source "$LIB_FILE"

  # devcontainer.json points GOOGLE_APPLICATION_CREDENTIALS at a fixed path
  # on this box, but nothing else writes a key file there -- that only
  # happens on the *calling* host in devpod-keepalive.sh/devpod-gce.sh, not
  # here. Without this, restic silently fails to auth to the GCS-backed
  # repo, gce_common_restic_pull_claude_session'"'"'s `2>/dev/null` swallows
  # it, and the seed never restores -- confirmed live, this was the actual
  # cause of "No conversation found with session ID" on the first real run.
  gce_common_reserve_sa_key_file
  gce_common_write_sa_key

  gce_common_restic_pull_claude_session

  # --permission-mode acceptEdits (not bypassPermissions/dontAsk): this runs
  # completely unattended, so it should still be stopped by anything that
  # would normally prompt outside plain edits -- there is no human here to
  # answer a prompt, so "stopped" is the safe failure mode, not "silently
  # allowed". --max-budget-usd is the CLI'"'"'s actual spend guard for print
  # mode; there is no --max-turns flag on the CLI (that'"'"'s an Agent SDK
  # option, confirmed against `claude --help`), so budget is the cap here.
  # --allowedTools is required in addition to --permission-mode: acceptEdits
  # covers file edits but does NOT grant MCP tool access on its own --
  # confirmed live, the Linear MCP tools got silently permission-denied
  # without this, and there'"'"'s no human here to approve the prompt.
  #
  # --allowedTools takes a variadic <tools...> list (confirmed via `claude
  # --help`), so without the `--` terminator below it silently swallows the
  # trailing prompt as another list entry, leaving no prompt at all --
  # confirmed live, this produced "No deferred tool marker found... Provide
  # a prompt to continue the conversation" even though a prompt was right
  # there on the command line.
  claude --resume "$CLAUDE_SESSION_ID" \
    --print \
    --model sonnet \
    --effort low \
    --max-budget-usd "$CLAUDE_MAX_BUDGET_USD" \
    --permission-mode acceptEdits \
    --allowedTools "mcp__claude_ai_Linear" \
    -- "keep going"

  gce_common_restic_push_claude_session
'
