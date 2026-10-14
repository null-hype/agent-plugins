#!/usr/bin/env bash
# Select an exact capture into a fixture directory. Run with restic credentials.
# refresh.sh <case> <snapshot-id> <destination>
set -euo pipefail
[ "$#" -eq 3 ] || { echo "usage: $0 <case> <snapshot-id> <destination>" >&2; exit 2; }
case_=$1 snapshot=$2 destination=$3
[[ "$case_" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo 'invalid case name' >&2; exit 2; }
[[ "$snapshot" =~ ^[0-9a-f]{8,64}$ ]] || { echo 'an exact snapshot ID is required' >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [ -n "${GCP_SERVICE_ACCOUNT_KEY:-}" ]; then
    export GOOGLE_APPLICATION_CREDENTIALS=$work/gcp-service-account.json
    (umask 077; printf %s "$GCP_SERVICE_ACCOUNT_KEY" > "$GOOGLE_APPLICATION_CREDENTIALS")
fi
# Resolve a backup's short ID, never a mutable tag or latest selector.
restic snapshots --json "$snapshot" > "$work/snapshots.json"
snapshot=$(jq -er 'if length == 1 then .[0].id else error("snapshot must resolve uniquely") end' "$work/snapshots.json")
base=/tmp/rails-cases/$case_
for file in commit.txt vale.json recordings.json; do
    restic dump "$snapshot" "$base/$file" > "$work/$file"
done
jq -e 'type == "array" and length > 0 and all(.digest | test("^sha256:[0-9a-f]{64}$"))' "$work/recordings.json" >/dev/null
jq --arg snapshot "$snapshot" 'map(. + {snapshot: $snapshot})' "$work/recordings.json" > "$work/selected.json"
# Validate every input before replacing any accepted fixture.
mkdir -p "$destination"
cp "$work/commit.txt" "$work/vale.json" "$destination/"
mv "$work/selected.json" "$destination/recordings.json"
printf '%s\n' "$snapshot"
