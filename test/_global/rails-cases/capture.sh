#!/bin/bash
# A case's keyed capture. The scenario directory supplies its input fixtures;
# installed features supply the method. The repository is not mounted.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case_=${RAILS_CASE:?} hash=${RAILS_CASE_HASH:?}
evidence="$here/../rails-cases-captures/$case_"
[ ! -e "$evidence" ] || { echo "capture already exists: $evidence" >&2; exit 1; }
: "${PROTON_PASS_PERSONAL_ACCESS_TOKEN:?The global capture requires a Proton Pass token}"
export PROTON_PASS_KEY_PROVIDER=fs PROTON_PASS_SESSION_DIR=/tmp/pass-agent-rails-cases
export PROTON_PASS_AGENT_REASON="rails-cases $case_: capture candidate Jev evidence"
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
        jev -q "$dir/questions.json" --request-out "$out/request.json" --response-out "$out/response.json" "$dir/payload.json" > "$out/answer.json"
    done
' bash "$work/payloads" "$evidence"
pkl eval -p case="$evidence" -o "$evidence/recordings.json" "$RAILS_CASES_HOME/Recordings.pkl"
pkl eval -p hash="$hash" -p case="$evidence" -o "$evidence/frame.json" "$RAILS_CASES_HOME/Frame.pkl"
pkl test -p hash="$hash" -p case="$evidence" "$here/Recordings.test.pkl"
printf "%s: capture in %s; pass this directory to the case check and viewer\n" "$case_" "$evidence"
