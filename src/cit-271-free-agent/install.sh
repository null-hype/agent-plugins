#!/bin/sh
set -e

echo "Activating feature 'cit-271-free-agent'"
echo "Hint level: ${HINTLEVEL}, model: ${MODEL}, repeats: ${REPEATS}"

SHARE=/usr/local/share/cit-271-free-agent
mkdir -p "$SHARE"
cp "$(dirname "$0")/state-positive.json" "$(dirname "$0")/state-control.json" "$(dirname "$0")/.env" "$SHARE/"
cp "$(dirname "$0")/run.sh" "$SHARE/run.sh"

# The bin is generated with this install's options baked in as its
# defaults, the same way src/pass-cli/install.sh bakes its into 'color'.
cat > /usr/local/bin/cit-271-free-agent <<EOF
#!/usr/bin/env bash
export CIT271_HINT_LEVEL="\${CIT271_HINT_LEVEL:-${HINTLEVEL}}"
export CIT271_MODEL="\${CIT271_MODEL:-${MODEL}}"
export CIT271_REPEATS="\${CIT271_REPEATS:-${REPEATS}}"
export CIT271_SHARE="$SHARE"
exec bash "$SHARE/run.sh" "\$@"
EOF
chmod +x /usr/local/bin/cit-271-free-agent

echo "cit-271-free-agent installed."
