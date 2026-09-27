#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 \"<prompt>\" [output.png]"
    exit 1
fi

PROMPT="$1"
OUTPUT_FILE="${2:-output.png}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="${SCRIPT_DIR}/../scratch/venv/bin/python3"
if [ ! -f "$VENV_PYTHON" ]; then
    VENV_PYTHON="${HOME}/.gemini/antigravity-cli/brain/12a1fdef-8335-44a0-9a46-077a8fdc8ff7/scratch/venv/bin/python3"
fi

export PROTON_PASS_SESSION_DIR="${PROTON_PASS_SESSION_DIR:-/tmp/pass-agent-antigravity}"
export PROTON_PASS_AGENT_REASON="Generate image using Gemini via AI Studio API key"

pass-cli run --env-file "${SCRIPT_DIR}/gemini.env" -- "$VENV_PYTHON" "${SCRIPT_DIR}/test_gemini_image.py" "$PROMPT" "$OUTPUT_FILE"
