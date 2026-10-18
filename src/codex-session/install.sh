#!/bin/sh
set -e

echo "Activating feature 'codex-session'"
echo "The requested @openai/codex version is: ${VERSION}"
echo "The requested model is: ${MODEL:-<codex default>}"
echo "The restic tag is: ${TAG}"

npm install -g "@openai/codex@${VERSION}"

# Codex reads config.toml from CODEX_HOME; seed the model there for the user
# who will actually run codex-session (install.sh itself runs as root).
TARGET_HOME="${_REMOTE_USER_HOME:-$HOME}"
mkdir -p "$TARGET_HOME/.codex"
if [ -n "${MODEL}" ] && ! grep -q '^model *=' "$TARGET_HOME/.codex/config.toml" 2>/dev/null; then
    printf 'model = "%s"\n' "${MODEL}" >> "$TARGET_HOME/.codex/config.toml"
fi
if [ -n "${_REMOTE_USER:-}" ]; then
    chown -R "$_REMOTE_USER" "$TARGET_HOME/.codex" || true
fi

# The bin is generated with this install's tag baked in as its default, the
# same way src/pass-cli/install.sh bakes its options into 'color'.
cat > /usr/local/bin/codex-session <<EOF
#!/usr/bin/env bash
# codex-session: one Codex login, rolled forward through restic.
#
#   codex-session seed [codex-home]   back up just auth.json from an existing,
#                                     logged-in CODEX_HOME (default ~/.codex)
#   codex-session restore             restore the latest session into CODEX_HOME
#   codex-session backup              back up CODEX_HOME's auth.json and
#                                     sessions/; prints the snapshot id
#   codex-session status              codex login status
#   codex-session review <dir> [args] restore, run 'codex exec review [args]'
#                                     in <dir>, back up; prints
#                                     {review, thread, snapshot} as JSON
#
# Codex refreshes its tokens as it uses them, so the backup after every
# review is what keeps the stored login current. Only auth.json and
# sessions/ are stored: config.toml (the model) belongs to this install.
#
# restic's secrets come from PASS_CLI_ENV_FILE (RESTIC_REPOSITORY,
# RESTIC_PASSWORD, GCP_SERVICE_ACCOUNT_KEY, GOOGLE_PROJECT_ID) through an
# active pass-cli session, unless RESTIC_REPOSITORY is already set.
set -euo pipefail

TAG="\${CODEX_SESSION_TAG:-${TAG}}"
export CODEX_HOME="\${CODEX_HOME:-\$HOME/.codex}"

log() { echo "codex-session: \$*" >&2; }

case "\${1:-}" in
    seed|restore|backup|status|review) ;;
    *) sed -n '2,15p' "\$0" >&2; exit 2 ;;
esac

if [ -z "\${RESTIC_REPOSITORY:-}" ]; then
    : "\${PASS_CLI_ENV_FILE:?codex-session: set PASS_CLI_ENV_FILE (restic secrets) or RESTIC_REPOSITORY}"
    export PROTON_PASS_AGENT_REASON="\${PROTON_PASS_AGENT_REASON:-codex-session: restic secrets for the \$TAG Codex session}"
    exec pass-cli run --env-file "\$PASS_CLI_ENV_FILE" -- "\$0" "\$@"
fi
# The GCS backend wants a key file, not the inline JSON pass-cli resolves;
# that key wins over any GOOGLE_APPLICATION_CREDENTIALS already set.
if [ -n "\${GCP_SERVICE_ACCOUNT_KEY:-}" ]; then
    export GOOGLE_APPLICATION_CREDENTIALS="\$(mktemp)"
    trap 'rm -f "\$GOOGLE_APPLICATION_CREDENTIALS"' EXIT
    printf %s "\$GCP_SERVICE_ACCOUNT_KEY" > "\$GOOGLE_APPLICATION_CREDENTIALS"
fi

backup() { # [auth-only]
    local paths=("\$CODEX_HOME/auth.json")
    [ "\${1:-}" != auth-only ] && [ -d "\$CODEX_HOME/sessions" ] && paths+=("\$CODEX_HOME/sessions")
    [ -f "\$CODEX_HOME/auth.json" ] || { log "no auth.json in \$CODEX_HOME -- nothing to back up"; return 1; }
    restic backup "\${paths[@]}" --tag "\$TAG" --json |
        jq -r 'select(.message_type == "summary") | .snapshot_id'
}

restore() {
    local latest id auth tmp
    latest=\$(restic snapshots --tag "\$TAG" --json | jq -c 'max_by(.time) // empty')
    [ -n "\$latest" ] || { log "no '\$TAG' snapshot yet -- run 'codex-session seed' where Codex is logged in"; return 1; }
    id=\$(jq -r .short_id <<< "\$latest")
    auth=\$(jq -r '.paths[] | select(endswith("/auth.json"))' <<< "\$latest")
    tmp=\$(mktemp -d)
    restic restore "\$id" --target "\$tmp" >&2
    # The snapshot keeps the absolute paths of whichever host backed it up.
    mkdir -p "\$CODEX_HOME"
    cp -a "\$tmp\$(dirname "\$auth")/." "\$CODEX_HOME/"
    rm -rf "\$tmp"
    log "restored snapshot \$id into \$CODEX_HOME"
}

review() { # dir [codex exec review args]
    local dir=\$1 events thread rollout out snapshot; shift
    restore
    events=\$(mktemp)
    # Codex's own sandbox needs unprivileged user namespaces (bwrap), which
    # containers usually lack; the container is the sandbox here.
    (cd "\$dir" && codex exec review -c 'sandbox_mode="danger-full-access"' --json "\$@") > "\$events" ||
        log "codex exec review exited \$?"
    thread=\$(jq -r 'select(.type == "thread.started") | .thread_id' "\$events" | head -1)
    rollout=\$( [ -n "\$thread" ] && find "\$CODEX_HOME/sessions" -name "*\$thread*.jsonl" | head -1 || true)
    out=\$( [ -n "\$rollout" ] && jq -cs 'map(select(.payload.item.type? == "ExitedReviewMode"))[-1].payload.item.review_output // empty' "\$rollout" || true)
    # Back up even a failed review: the login may have refreshed regardless.
    snapshot=\$(backup)
    [ -n "\$out" ] || { log "no review output (thread \${thread:-none})"; return 1; }
    jq -n --argjson review "\$out" --arg thread "\$thread" --arg snapshot "\$snapshot" '{review: \$review, thread: \$thread, snapshot: \$snapshot}'
}

case "\${1:-}" in
    seed) CODEX_HOME="\${2:-\$CODEX_HOME}" backup auth-only ;;
    restore) restore ;;
    backup) backup ;;
    status) codex login status ;;
    review) shift; review "\$@" ;;
esac
EOF
chmod +x /usr/local/bin/codex-session
