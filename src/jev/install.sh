#!/bin/sh
set -e

echo "Activating feature 'jev'"

# The 'jev' client is Python. The request contract is Pkl (pkl/Jev.pkl), consumed
# through the pkl-python binding, which drives the `pkl` binary and needs
# msgpack/requests -- so the bin runs from its own venv rather than the system
# python (PEP 668 images refuse a system-wide pip install).
PKL_VERSION="0.32.1"      # same pin as the evidence feature (which installs pkl first when present)
PKL_PYTHON_VERSION="0.1.19"  # the version jev_pkl.py was generated with
JEV_HOME=/usr/local/lib/jev

if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import venv, ensurepip' >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -y && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates
    else
        echo "python3 (with venv) is required and no supported package manager was found" >&2
        exit 1
    fi
fi

case "$(uname -m)" in
    x86_64)         PKL_ARCH=amd64 ;;
    aarch64|arm64)  PKL_ARCH=aarch64 ;;
    *) echo "unsupported architecture $(uname -m) for pkl" >&2; exit 1 ;;
esac
if ! command -v pkl >/dev/null 2>&1; then
    curl -fsSL -o /usr/local/bin/pkl \
        "https://github.com/apple/pkl/releases/download/${PKL_VERSION}/pkl-linux-${PKL_ARCH}"
    chmod 0755 /usr/local/bin/pkl
fi

FEATURE_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$JEV_HOME"
python3 -m venv "$JEV_HOME/venv"
"$JEV_HOME/venv/bin/pip" install --quiet "pkl-python==${PKL_PYTHON_VERSION}"
# The contract and the Python types generated from it (regenerate jev_pkl.py per NOTES.md).
mkdir -p /usr/local/share/jev/pkl
install -m 0644 "$FEATURE_DIR/pkl/Jev.pkl" /usr/local/share/jev/pkl/Jev.pkl   # on the evidence adapter's --module-path
install -m 0644 "$FEATURE_DIR/jev_pkl.py" "$JEV_HOME/jev_pkl.py"

# The client bin, running under the venv's python.
sed "1s|.*|#!$JEV_HOME/venv/bin/python|" "$FEATURE_DIR/jev" > /usr/local/bin/jev
chmod 0755 /usr/local/bin/jev

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
