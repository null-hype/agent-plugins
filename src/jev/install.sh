#!/bin/sh
set -e

echo "Activating feature 'jev'"

# The 'jev' client is Python + stdlib only (urllib/json), matching the sibling
# 'evidence' method feature -- no pip, no third-party runtime. Ensure python3.
if ! command -v python3 >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -y && apt-get install -y --no-install-recommends python3
    else
        echo "python3 is required and no supported package manager was found" >&2
        exit 1
    fi
fi

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"

# The client bin.
install -m 0755 "$FEATURE_DIR/jev" /usr/local/bin/jev

# The transport contract, installed so it exists in the target container (the
# same way the 'evidence' feature installs its schema under /usr/local/share).
# The bin validates in Python; this file is the externally-consumable contract a
# pkl-aware consumer can evaluate an instance against.
mkdir -p /usr/local/share/jev
install -m 0644 "$FEATURE_DIR/pkl/Jev.pkl" /usr/local/share/jev/Jev.pkl

# install.sh always runs as root, so a plain '~' here resolves to /root -- a
# different home than whichever user actually invokes 'jev' (and reads its
# skills) later. Use _REMOTE_USER_HOME so both agree on one home directory, and
# chown the result so a non-root remote user can read it. Same reasoning the
# playwright-cli and pass-cli feature installs document.
TARGET_HOME="${_REMOTE_USER_HOME:-$HOME}"

# 1) First-party 'jev' skill: teaches an agent to use THIS bin and the
#    capture -> validate -> jev -> probabilities chain (the composition
#    "meta-skill"). Shipped as a static file and copied in, the pass-cli way.
mkdir -p "$TARGET_HOME/.claude/skills/jev"
cp "$FEATURE_DIR/.claude/skills/jev/SKILL.md" "$TARGET_HOME/.claude/skills/jev/SKILL.md"

# 2) Third-party TypeSafe skill (the Jev/Noul API reference), installed live the
#    way the CIT-289 issue comment points at -- analogous to how playwright-cli
#    installs its own skill at build time. `npx skills add` supports a fully
#    non-interactive install (--yes to skip prompts, --agent to pick the target
#    instead of the interactive "select your agent", --copy so the file is a real
#    copy rather than a symlink into a node_modules tree that won't survive).
#    Run under the target HOME so it lands in that user's ~/.claude/skills.
#    Requires node/npx -- guaranteed by this feature's dependsOn node.
if command -v npx >/dev/null 2>&1; then
    HOME="$TARGET_HOME" npx --yes skills add typesafe-ai/skills \
        --skill typesafe-ai --agent claude-code --global --yes --copy
else
    echo "npx not found; skipping the third-party TypeSafe skill install." >&2
    echo "Add the node feature (this feature dependsOn it) so npx is present." >&2
    exit 1
fi

if [ -n "${_REMOTE_USER:-}" ]; then
    # Best-effort: ownership is a permissions nicety, not something that should
    # fail the whole feature install if _REMOTE_USER isn't a real user yet.
    chown -R "$_REMOTE_USER" "$TARGET_HOME/.claude" || true
fi
