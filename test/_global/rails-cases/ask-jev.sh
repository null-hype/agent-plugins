#!/bin/bash
# A case's keyed capture. The scenario directory supplies its input fixtures;
# installed features supply the method. The repository is not mounted.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case_=${RAILS_CASE:?} hash=${RAILS_CASE_HASH:?}
evidence=/tmp/rails-cases/$case_
: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?The global capture requires a Proton Pass token}"
export PROTON_PASS_KEY_PROVIDER=fs PROTON_PASS_SESSION_DIR=/tmp/pass-agent-rails-cases
export PROTON_PASS_AGENT_REASON="rails-cases $case_: capture and select Jev evidence"
pass-cli login
work=$(mktemp -d)
trap 'rm -rf "$work"; pass-cli logout >/dev/null 2>&1 || true' EXIT
mkdir -p "$evidence"
cp "$here/../$case_/commit.txt" "$here/../$case_/vale.json" "$evidence/"
printf '[]\n' > "$evidence/recordings.json"
printf '[]\n' > "$evidence/snapshots.json"
pkl eval -m "$work/payloads" -p hash="$hash" -p case="$evidence" "$RAILS_CASES_HOME/Payloads.pkl"
pass-cli run --env-file "$here/.env" -- bash -euo pipefail -c '
    for dir in "$1"/*/; do
        out=$2/jev/$(basename "$dir")
        mkdir -p "$out"
        jev -q "$dir/questions.json" --request-out "$out/request.json" "$dir/payload.json" > "$out/answer.json"
    done
' bash "$work/payloads" "$evidence"
for out in "$evidence"/jev/*/; do
    jq -n --arg digest "sha256:$(basename "$out")" --slurpfile answer "$out/answer.json" --slurpfile request "$out/request.json" \
        '{digest: $digest, score: $answer[0].probabilities.claim, request: $request[0]}'
done | jq -s . > "$evidence/recordings.json"
jq -e 'length > 0 and all(.score | type == "number" and . >= 0 and . <= 1)' "$evidence/recordings.json" >/dev/null
pass-cli run --env-file "$here/.env" -- bash -euo pipefail -c '
    export GOOGLE_APPLICATION_CREDENTIALS=$3/gcp-service-account.json
    (umask 077; printf %s "$GCP_SERVICE_ACCOUNT_KEY" > "$GOOGLE_APPLICATION_CREDENTIALS")
    restic backup "$1" --tag "$2" --json
' bash "$evidence" "$case_" "$work" > "$work/backup.json"
snapshot=$(jq -ers 'map(select(.message_type=="summary")) | .[-1].snapshot_id | select(type == "string" and length > 0)' "$work/backup.json")
selected="$here/../rails-cases-captures/$case_"
pass-cli run --env-file "$here/.env" -- "$RAILS_CASES_HOME/refresh.sh" "$case_" "$snapshot" "$selected"
printf '[]\n' > "$selected/snapshots.json"
pkl test -p hash="$hash" -p case="$selected" "$here/Recordings.test.pkl"
# Selecting the same snapshot twice must produce identical bytes.
pass-cli run --env-file "$here/.env" -- "$RAILS_CASES_HOME/refresh.sh" "$case_" "$snapshot" "$work/again"
for file in commit.txt vale.json recordings.json; do cmp "$selected/$file" "$work/again/$file"; done
printf '%s: selected snapshot %s\n' "$case_" "$snapshot"
