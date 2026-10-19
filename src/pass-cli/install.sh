#!/bin/sh
set -e

echo "Activating feature 'color'"
echo "The provided favorite color is: ${FAVORITE}"


# The 'install.sh' entrypoint script is always executed as the root user.
#
# These following environment variables are passed in by the dev container CLI.
# These may be useful in instances where the context of the final
# remoteUser or containerUser is useful.
# For more details, see https://containers.dev/implementors/features#user-env-var
echo "The effective dev container remoteUser is '$_REMOTE_USER'"
echo "The effective dev container remoteUser's home directory is '$_REMOTE_USER_HOME'"

echo "The effective dev container containerUser is '$_CONTAINER_USER'"
echo "The effective dev container containerUser's home directory is '$_CONTAINER_USER_HOME'"

cat > /usr/local/bin/color \
<< EOF
#!/bin/sh
set -e

# AGENT_ASSIGNMENT names which restic snapshot this invocation of 'color'
# backs up to / restores from, and doubles as the pass-cli agent-reason
# prefix below. It is derived from this feature's own "tag" option so a
# scenario only has to set that one value to keep its restic tag, its
# Dockerfile's SCENARIO_NAME and this bin's notion of "which assignment
# am I" all in agreement, instead of hardcoding the same string three
# times (see test/_global/jin-91-resume-session/Dockerfile).
AGENT_ASSIGNMENT="${TAG}"

# 'color start' is the feature's postStartCommand: every container start
# continues the session named in /workspaces/.color-session, or else the
# session option; with neither, it does nothing. The file is the machine's
# own pointer: /workspaces survives a rebuild (~/.claude does not), and it
# is never committed, so a shared devcontainer.json can leave the option
# empty without every codespace built from it resuming the same session.
if [ "\${1:-}" = "start" ]; then
    session="\$(cat /workspaces/.color-session 2>/dev/null || echo "${SESSION}")"
    [ -n "\$session" ] || exit 0
    exec "\$0" resume "\$session"
fi

# 'color resume <session-id>' continues an existing session in the
# background (claude --bg), so it can be picked up from claude.ai. After a
# stop/start the transcript is still on disk and is used as is; restoring
# over it would roll it back to the last snapshot. Only when it is missing
# (a rebuild, a new machine) is it restored, from the newest snapshot that
# holds it: other hosts back up under the same tag, so 'latest' can be
# another machine's ~/.claude.
if [ "\${1:-}" = "resume" ] && [ -n "\${2:-}" ]; then
    SESSION_ID="\$2"
    # Claude's installer puts it here; a postStartCommand's PATH may have
    # been probed before it existed.
    export PATH="\$HOME/.local/bin:\$PATH"
    export PROTON_PASS_KEY_PROVIDER="\${PROTON_PASS_KEY_PROVIDER:-fs}"
    if ! ls "\$HOME"/.claude/projects/*/"\$SESSION_ID".jsonl >/dev/null 2>&1; then
        : "\${PASS_CLI_ENV_FILE:?color resume: set PASS_CLI_ENV_FILE (restic secrets)}"
        pass-cli info >/dev/null 2>&1 || timeout 2m pass-cli login >&2
        export PROTON_PASS_AGENT_REASON="\${AGENT_ASSIGNMENT}: restoring Claude session \$SESSION_ID"
        pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- sh -c '
            set -e
            export GOOGLE_APPLICATION_CREDENTIALS="\$(mktemp)"
            trap "rm -f \$GOOGLE_APPLICATION_CREDENTIALS" EXIT
            printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
            snap=\$(restic find --json --tag '"\$AGENT_ASSIGNMENT"' "\$1.jsonl" | jq -r "max_by(.matches[0].mtime) | .snapshot // empty")
            [ -n "\$snap" ] || { echo "color resume: no snapshot holds session \$1" >&2; exit 1; }
            # Leave out the runtime state of the background daemon: its lock names
            # a pid from the old machine (a live process here, or worse,
            # someone else), and stale job records make --bg think the
            # session is still running.
            restic restore "\$snap" --target "\$HOME" \\
                --exclude "/.claude/daemon*" --exclude /.claude/jobs
        ' sh "\$SESSION_ID"
        # ~/.claude.json (workspace trust, the account) lives outside
        # ~/.claude, but Claude keeps copies of it inside.
        [ -e "\$HOME/.claude.json" ] || cp "\$(ls -t "\$HOME"/.claude/backups/.claude.json.backup.* | head -1)" "\$HOME/.claude.json"
    fi
    # --remote-control registers the session with the account, so it can be
    # driven from the Claude app on a phone -- the point of resuming it on a
    # box nobody is sitting at. acceptEdits: file edits go ahead, anything
    # else waits for a person to approve it there.
    out="\$(claude --bg --remote-control --resume "\$SESSION_ID" --model ${MODEL} --effort ${EFFORT} --permission-mode acceptEdits \\
        "The container just started and 'color resume' continued this session. Carry on where you left off.")"
    echo "\$out"
    # --bg continues under a new id when it thinks the session is still running.
    short="\$(printf '%s\n' "\$out" | grep -o 'claude logs [0-9a-f]*' | cut -d' ' -f3)"
    [ -z "\$short" ] || jq -r .sessionId "\$HOME/.claude/jobs/\$short/state.json" > /workspaces/.color-session
    exit 0
fi

echo "my favorite color is ${FAVORITE}"

# If pass-cli is on PATH, configured (PASS_CLI_ENV_FILE set - baked into
# the image by scenarios that want this), and already logged in, also
# ask claude something and snapshot this session's transcript to restic.
# The live-login check means this is safe to leave enabled unconditionally:
# a caller who hasn't logged in (or doesn't have pass-cli at all) just
# gets the plain favorite-color line, same as before.
if [ -n "\${PASS_CLI_ENV_FILE:-}" ] && command -v pass-cli >/dev/null 2>&1 && pass-cli info >/dev/null 2>&1; then
    export PROTON_PASS_AGENT_REASON="\${AGENT_ASSIGNMENT} scenario: color bin asking claude its favorite color"
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- claude -p --model ${MODEL} --effort ${EFFORT} "What is your favorite color? Also list the names of any skills you currently have available, one per line."

    # The GCS backend restic uses wants GOOGLE_APPLICATION_CREDENTIALS
    # pointing at a key *file*, not the inline JSON pass-cli resolves
    # into GCP_SERVICE_ACCOUNT_KEY, so materialize that first.
    #
    # CIT-147: --json's trailing {"message_type":"summary",...,
    # "snapshot_id":...} line is this invocation's own authoritative
    # report of the exact snapshot it just produced -- written to a fixed
    # path so a caller (e.g. test/pass-cli/restic-backup.sh) can bind
    # evidence to precisely this backup. Querying "restic snapshots --tag"
    # afterward and guessing (by array order, or even by before/after set
    # difference) can't offer the same guarantee: this restic repo is a
    # persistent remote shared across CI runs, so a concurrent run's
    # snapshot landing in that same window is a real possibility a query
    # against the shared remote can't rule out, but the backup call's own
    # return value isn't a query at all.
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- sh -c '
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS="/tmp/gcp-service-account.json"
        printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
        restic backup ~/.claude --tag '"\$AGENT_ASSIGNMENT"' --json > /tmp/pass-cli-restic-backup.json
    '
fi

# 'color resume' bakes in the plant -> backup -> restore -> resume ->
# verify round trip that a restic snapshot of ~/.claude/projects is
# actually restorable and that 'claude --resume' on the restored
# transcript picks up where the original session left off. This used to
# live in test/_global/jin-91-resume-session.sh itself; moving it here
# means the global test just exercises this bin like any other consumer
# of the feature would, the same way jin-81-pass-cli.sh exercises the
# backup block above rather than reimplementing it.
if [ "\${1:-}" = "resume" ]; then
    if [ -z "\${PASS_CLI_ENV_FILE:-}" ] || ! command -v pass-cli >/dev/null 2>&1 || ! pass-cli info >/dev/null 2>&1; then
        echo "color resume: requires PASS_CLI_ENV_FILE and an active pass-cli session" >&2
        exit 1
    fi

    # A fixed session id (rather than parsing one out of
    # --output-format json) is what makes the --resume call below able
    # to name the exact session to resume without any string-scraping.
    SESSION_ID="\$(cat /proc/sys/kernel/random/uuid)"
    CODEWORD="\$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \\n')"

    export PROTON_PASS_AGENT_REASON="\${AGENT_ASSIGNMENT} scenario: planting codeword in a fresh session"
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- claude -p \\
        --session-id "\$SESSION_ID" --model ${MODEL} --effort ${EFFORT} \\
        --permission-mode dontAsk --allowedTools=Bash \\
        "Remember that the codeword is \$CODEWORD. Reply with exactly one line: ok" >&2

    echo "Backing up ~/.claude/projects (tag: \$AGENT_ASSIGNMENT) and moving the local copy aside..." >&2
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- sh -c '
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS="/tmp/gcp-service-account.json"
        printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
        restic backup \$HOME/.claude/projects --tag '"\$AGENT_ASSIGNMENT"'
    '
    # Move only the transcript directory aside, not the whole ~/.claude
    # tree: that tree also holds the OAuth credential cache and the
    # installed pass-cli skill, neither of which this is testing the
    # restorability of, and both of which the --resume call below still
    # needs intact.
    mv "\$HOME/.claude/projects" "\$HOME/.claude-projects-preresume"

    echo "Restoring the snapshot..." >&2
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- sh -c '
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS="/tmp/gcp-service-account.json"
        printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
        restic restore latest --tag '"\$AGENT_ASSIGNMENT"' --target /
    '

    # Discriminates a restic/path problem from a --resume semantics
    # problem: if this is missing, the snapshot didn't come back where
    # expected; if it's present and the codeword check below still
    # fails, the problem is in --resume itself.
    if ! ls "\$HOME"/.claude/projects/*/"\$SESSION_ID".jsonl >/dev/null 2>&1; then
        echo "color resume: restored snapshot is missing the session transcript" >&2
        exit 1
    fi

    export PROTON_PASS_AGENT_REASON="\${AGENT_ASSIGNMENT} scenario: resuming restored session to read back the codeword"
    response="\$(pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- claude -p \\
        --resume "\$SESSION_ID" --model ${MODEL} --effort ${EFFORT} \\
        --permission-mode dontAsk --allowedTools=Bash \\
        'What was the codeword? Reply with exactly one line: "codeword: <value>".')"

    echo "\$response"

    case "\$response" in
        *"\$CODEWORD"*) exit 0 ;;
        *)
            echo "color resume: restored session did not recall the codeword" >&2
            exit 1
            ;;
    esac
fi
EOF


# Install the pass-cli skill so claude knows how to use pass-cli itself
# for any future task, rather than us documenting usage by hand.
#
# `pass-cli agent instructions` needs an authenticated session, which
# isn't available (and shouldn't be baked into the image) at build
# time. So instead of calling pass-cli live, ship its output as a
# static file (regenerated with `make` on a machine with a real
# session) and just install that.
#
# install.sh always runs as root, so plain `~` here would resolve to
# /root - a different home than whichever user actually invokes
# `color` later (and whose `~/.claude` the generated bin's restic
# backup targets at runtime). Use _REMOTE_USER_HOME so both agree on
# the same home directory, and chown the result so that user can
# actually read it when it isn't root.
TARGET_HOME="${_REMOTE_USER_HOME:-$HOME}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$TARGET_HOME/.claude/skills/pass-cli"
cp "$SCRIPT_DIR/.claude/skills/pass-cli/SKILL.md" "$TARGET_HOME/.claude/skills/pass-cli/SKILL.md"
if [ -n "${_REMOTE_USER:-}" ]; then
    # Best-effort: ownership is a permissions nicety, not something that
    # should fail the whole feature install if _REMOTE_USER somehow
    # isn't a real system user yet at this point.
    chown -R "$_REMOTE_USER" "$TARGET_HOME/.claude" || true
fi


chmod +x /usr/local/bin/color
