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
    pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- sh -c '
        set -e
        export GOOGLE_APPLICATION_CREDENTIALS="/tmp/gcp-service-account.json"
        printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
        restic backup ~/.claude --tag '"\$AGENT_ASSIGNMENT"'
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
