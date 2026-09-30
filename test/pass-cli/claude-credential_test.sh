#!/bin/bash
# Exercise credential failure handling without accessing Proton Pass or Claude.
set -eu
guard=${1:-/usr/local/lib/pass-cli/claude-with-pass}
task_dir=$(mktemp -d)
trap 'rm -rf "$task_dir"' EXIT
mkdir "$task_dir/bin"
export TASK_CLAUDE_STARTED="$task_dir/started"
cat > "$task_dir/bin/pass-cli" <<'EOF'
#!/bin/sh
case "$TASK_PASS_RESULT" in
    denied)
        echo 'Failed to retrieve item claude from share anthropic.ai' >&2
        echo 'Could not find vault anthropic.ai' >&2
        exit 1 ;;
    transport)
        echo 'Failed to retrieve item claude from share anthropic.ai: connection timed out' >&2
        exit 7 ;;
    permitted)
        while [ "$1" != '--' ]; do shift; done
        shift
        exec "$@" ;;
esac
EOF
chmod +x "$task_dir/bin/pass-cli"
export PATH="$task_dir/bin:$PATH"

status=0
TASK_PASS_RESULT=denied sh "$guard" --env-file unused -- sh -c 'touch "$TASK_CLAUDE_STARTED"' || status=$?
test "$status" -eq 3
test ! -e "$TASK_CLAUDE_STARTED"

status=0
TASK_PASS_RESULT=transport sh "$guard" --env-file unused -- sh -c 'touch "$TASK_CLAUDE_STARTED"' || status=$?
test "$status" -eq 7
test ! -e "$TASK_CLAUDE_STARTED"

TASK_PASS_RESULT=permitted sh "$guard" --env-file unused -- sh -c 'touch "$TASK_CLAUDE_STARTED"'
test -e "$TASK_CLAUDE_STARTED"
status=0
TASK_PASS_RESULT=permitted sh "$guard" --env-file unused -- sh -c 'exit 9' || status=$?
test "$status" -eq 9

status=0
TASK_PASS_RESULT=permitted sh "$guard" --env-file unused -- sh -c 'exit 3' || status=$?
test "$status" -eq 1
