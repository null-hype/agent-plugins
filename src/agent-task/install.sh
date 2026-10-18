#!/bin/sh
set -e

echo "Activating feature 'agent-task'"
echo "Model: ${MODEL}, review: ${REVIEW}, workspace: ${WORKSPACE:-<workspace folder>}"

SHARE=/usr/local/share/agent-task
mkdir -p "$SHARE"
cp "$(dirname "$0")/run.sh" "$(dirname "$0")/.env" "$SHARE/"
# The prompt is free text: keep it in a file rather than in generated shell.
printf '%s' "${PROMPT}" > "$SHARE/prompt.txt"

cat > /usr/local/bin/agent-task <<EOF
#!/usr/bin/env bash
export AGENT_TASK_MODEL="\${AGENT_TASK_MODEL:-${MODEL}}"
export AGENT_TASK_REVIEW="\${AGENT_TASK_REVIEW:-${REVIEW}}"
export AGENT_TASK_WORKSPACE="\${AGENT_TASK_WORKSPACE:-${WORKSPACE:-\$PWD}}"
export AGENT_TASK_SHARE="$SHARE"
exec bash "$SHARE/run.sh" "\$@"
EOF
chmod +x /usr/local/bin/agent-task

echo "agent-task installed."
