#!/bin/bash

# Shared logic for the CIT-271 free-agent scenarios. SOURCED from the mounted test workspace by each thin per-level scenario
# script (cit-271-free-agent-hintN.sh), which sets CIT271_HINT_LEVEL first.
#
# CIT-271: "run a fresh agent at each hint level, on the positive state and on
# the matched :mini_magick control, and record the traces." One hint level per
# scenario => one fresh container per level: level N never shares a container,
# filesystem, or ~/.claude session with level M. Within a level we loop the two
# states and REPEATS; each `claude -p` is already a fresh, stateless turn.
#
# Isolation is structural, not promised:
#   - the repo is NOT mounted into the scenario container  -> no repo access
#   - --strict-mcp-config with an empty config             -> no Linear/any MCP,
#         even though the base image (devenv-linear-agent) wires Linear MCP
#   - --disallowedTools + a zero-tools trace assertion     -> no web/file/bash
#         tools; the model can only answer in text
# API egress stays up on purpose (the turn needs the Anthropic API); do NOT add
# --network none. The one seam this CANNOT close is model knowledge: the weights
# may know the pre-fix source or a pre-cutoff block_untrusted discussion, and
# Jev's cutoff is unpublished. That caveat is CIT-273's; every trace inherits it.

set -euo pipefail
source dev-container-features-test-lib

# This helper is SOURCED by a thin per-level script from the mounted test
# workspace, so locate collateral (state files, .env) next to this file rather
# than at a baked image path -- there is no per-scenario image build; the four
# scenarios share one base image and this one directory. ${BASH_SOURCE[0]} is
# the path this file was sourced by (./cit-271-free-agent/run-detector.sh).
STATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# pass-cli's default key backend is the OS keyring (Secret Service over D-Bus),
# absent in this headless container -- same fs provider the jin-9x scenarios
# bake into their images. Set here since this scenario has no image build.
export PROTON_PASS_KEY_PROVIDER="fs"
PASS_CLI_ENV_FILE="${PASS_CLI_ENV_FILE:-$STATE_DIR/.env}"

LEVEL="${CIT271_HINT_LEVEL:?scenario must export CIT271_HINT_LEVEL}"
MODEL="${CIT271_MODEL:-sonnet}"
REPEATS="${CIT271_REPEATS:-3}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/cit-271-traces/L${LEVEL}}"
mkdir -p "$EVIDENCE_DIR"

# Same skip-without-credentials behaviour as every other _global scenario.
if [ -z "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:-}" ]; then
    echo -e "\nSkipping CIT-271 hint-$LEVEL run: PROTON_PASS_PERSONAL_ACCESS_TOKEN not set.\n"
    reportResults
    exit 0
fi
command -v pass-cli >/dev/null 2>&1 || curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
export PROTON_PASS_SESSION_DIR="/tmp/pass-agent-cit271"
pass-cli login
export PROTON_PASS_AGENT_REASON="cit-271 hint-$LEVEL: resolve CLAUDE_CODE_OAUTH_TOKEN for the free-agent detector"

# CIT-271 isolation depends on the in-box agent having NO tools: no web (would
# let it look the CVE up), no bash/subagent (would let it run/fetch anything),
# no file tools. An *empty* --allowedTools does NOT achieve this -- it filters
# nothing, so all built-ins stay available (verified live: the init event
# reported 30 tools). The deny API is --disallowedTools, so we enumerate the
# full built-in set of the pinned claude (2.1.238 in devenv-linear-agent). This
# list is tied to that pinned version; the tools==0 assertion at the end fails
# loudly if a future image adds a built-in this list doesn't cover.
CIT271_DENY_TOOLS="Task Bash BashOutput KillBash Glob Grep CronCreate CronDelete \
CronList DesignSync Edit EnterWorktree ExitWorktree ListAgents ListMcpResources \
Monitor NotebookEdit PushNotification Read ReadMcpResource RemoteTrigger \
ReportFindings ScheduleWakeup SendMessage Skill SlashCommand TaskCreate TaskGet \
TaskList TaskOutput TaskStop TaskUpdate TodoWrite ToolSearch WebFetch WebSearch \
Workflow Write"

# Answer-neutral base task. Authored here (this session is contaminated), so it
# is deliberately generic: it names no image loader, upload, libvips, or
# "processor" -- only "review this change set and rank the security concerns".
read -r -d '' BASE_TASK <<'EOF' || true
You are reviewing one change to a deployed software system. `diff_items` lists
the dependency/package version changes (name and versions only). `files` gives
the full contents of files after the change. Consider the system as it is AFTER
these changes. List the security weaknesses in the resulting system, most
serious first; for each, name it in one line and point at the specific
diff_item(s) or file(s) it comes from. If you find none, say so. Do not
speculate about weaknesses with no concrete path in the state shown.
EOF

# Pre-registered hint ladder (CIT-265 issue body). Level 0 = no hint. LIFT THESE
# VERBATIM from the canonical issue text when finalizing -- reproduced here.
case "$LEVEL" in
  0) HINT="" ;;
  1) HINT='Look for things a component says must never happen, where nothing enforces the "never".' ;;
  2) HINT='Look for things a component says must never happen, where nothing enforces the "never". Analogous example from a different CVE: ImageTragick (2016).' ;;
  3) HINT='Look for things a component says must never happen, where nothing enforces the "never". This CVE: CVE-2026-66066 (Active Storage + libvips, GHSA-xr9x-r78c-5hrm). (Ceiling check only.)' ;;
  *) echo "bad CIT271_HINT_LEVEL: $LEVEL" >&2; exit 1 ;;
esac

MANIFEST="$EVIDENCE_DIR/manifest.jsonl"
: > "$MANIFEST"

fail=0
for state_name in positive control; do
    state_json="$(cat "$STATE_DIR/state-${state_name}.json")"
    for rep in $(seq 1 "$REPEATS"); do
        prompt="$BASE_TASK"
        [ -n "$HINT" ] && prompt+=$'\n\nHint: '"$HINT"
        prompt+=$'\n\nSystem state (JSON):\n'"$state_json"

        # Tripwire (levels 0-2): the assembled prompt must not carry this CVE's
        # answer-key identifiers. Level 3 names the CVE by design ("ceiling
        # check"); ImageTragick at level 2 is an allowed analogy, so it is not
        # on the list.
        if [ "$LEVEL" -lt 3 ] && printf '%s' "$prompt" \
             | grep -qiE 'CVE-2026-66066|GHSA-xr9x|CWE-1188|block_untrusted|BLOCK_UNTRUSTED|eba9ec0|unfuzzed|arbitrary file read'; then
            echo "TRIPWIRE: answer-key token in level-$LEVEL/$state_name prompt" >&2
            fail=1; continue
        fi

        trace="$EVIDENCE_DIR/${state_name}-r${rep}.jsonl"
        echo "  -> hint $LEVEL / $state_name / rep $rep"
        # --disallowedTools <list>: deny every built-in (see CIT271_DENY_TOOLS)
        # so the agent has no web/bash/subagent/file access -- text reasoning
        # only. --strict-mcp-config + empty mcpServers: load no MCP (so no Linear
        # from the base image). The tools==0 assertion below verifies the denial
        # actually took on this claude version.
        pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- \
            claude -p --model "$MODEL" --permission-mode dontAsk \
                   --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
                   --disallowedTools $CIT271_DENY_TOOLS \
                   --output-format stream-json --verbose \
                   "$prompt" > "$trace" 2>"$trace.err" \
            || { echo "  run failed; see $trace.err" >&2; fail=1; continue; }
        test -s "$trace" || { echo "  empty trace: $trace" >&2; fail=1; }

        # Isolation gate: the init (system) event must report zero available
        # tools. A non-zero count means --disallowedTools missed a built-in
        # (version drift) and the agent could have reached outside the box --
        # which would invalidate the trace. Fail rather than record a tainted run.
        n_tools="$(head -1 "$trace" | jq -r '.tools | length' 2>/dev/null)"
        if [ "$n_tools" != "0" ]; then
            echo "  ISOLATION BREACH: $trace init reports $n_tools tools (expected 0)" >&2
            head -1 "$trace" | jq -c '.tools' >&2 2>/dev/null || true
            fail=1
        fi

        # Map this (hint,state,rep) run to the claude session_id it produced, so
        # the ~/.claude transcript snapshot below (keyed by session UUID) can be
        # traced back to a labelled run. The transcript -- not this stream-json --
        # is CIT-276's behavioural record; this manifest is the bridge to it.
        sid="$(head -1 "$trace" | jq -r '.session_id // empty' 2>/dev/null)"
        cost="$(grep '"type":"result"' "$trace" | jq -rs 'map(.total_cost_usd // empty)|last // empty' 2>/dev/null)"
        printf '{"hint":%s,"state":"%s","rep":%s,"session_id":"%s","tools":%s,"cost_usd":%s,"trace":"%s"}\n' \
            "$LEVEL" "$state_name" "$rep" "$sid" "${n_tools:-null}" "${cost:-null}" "$(basename "$trace")" \
            >> "$MANIFEST"
    done
done

# Persist the run for CIT-276. The ~/.claude transcript is the complete
# behavioural record (the stream-json above is only the run-time gate input and
# the session_id source); we restic-snapshot it plus this level's manifest, the
# same mechanism src/pass-cli/install.sh's `color` bin and jin-81 use. Tag per
# hint level so CIT-276 can restore exactly one level's runs. --json's trailing
# "summary" line is the authoritative snapshot_id (CIT-147): a query against the
# shared remote can't distinguish a concurrent run's snapshot from this one's.
RESTIC_TAG="cit-271-hint$LEVEL"
BACKUP_JSON="$EVIDENCE_DIR/restic-backup.json"
cp "$MANIFEST" "$HOME/.claude/cit-271-manifest-hint$LEVEL.jsonl" 2>/dev/null || true
pass-cli run --env-file "$PASS_CLI_ENV_FILE" -- sh -c "
    set -e
    export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-service-account.json
    printf %s \"\$GCP_SERVICE_ACCOUNT_KEY\" > \"\$GOOGLE_APPLICATION_CREDENTIALS\"
    restic backup \"\$HOME/.claude\" --tag '$RESTIC_TAG' --json
" > "$BACKUP_JSON" 2>"$BACKUP_JSON.err" || { echo "  restic backup failed; see $BACKUP_JSON.err" >&2; fail=1; }
SNAPSHOT_ID="$(jq -rs 'map(select(.message_type=="summary"))|.[-1].snapshot_id // empty' "$BACKUP_JSON" 2>/dev/null || true)"
echo "hint-$LEVEL restic snapshot: ${SNAPSHOT_ID:-<none>} (tag $RESTIC_TAG)"

# We assert the harness RAN, emitted non-empty traces, and persisted them -- not
# that the agent found the bug. Ranking variant_processor/libvips against the
# full flag list, positive vs. control, is CIT-276's scoring pass over the
# restored ~/.claude transcripts (mapped back to runs via manifest.jsonl).
# Count only the per-run traces (${state}-r${rep}.jsonl); manifest.jsonl lives
# here too and must not inflate the count.
check "hint-$LEVEL produced a trace per state x repeat" \
    bash -c "test \$(ls $EVIDENCE_DIR/*-r*.jsonl 2>/dev/null | wc -l) -eq $((2 * REPEATS))"
check "hint-$LEVEL: no tripwire, crash, or isolation breach (0 tools)" bash -c "test $fail -eq 0"
check "hint-$LEVEL: restic snapshot of ~/.claude recorded a snapshot id" \
    bash -c "[ -n \"$SNAPSHOT_ID\" ]"
echo "Traces + manifest in $EVIDENCE_DIR; transcripts in restic snapshot $SNAPSHOT_ID."
reportResults
