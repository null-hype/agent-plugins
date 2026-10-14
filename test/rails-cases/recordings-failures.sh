#!/usr/bin/env bash
# Prove that an accepted recording cannot silently answer a changed request.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fixtures=$1 hash=$2
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$fixtures/commit.txt" "$fixtures/vale.json" "$fixtures/snapshots.json" "$work/"
for mutation in empty duplicate request score; do
    python3 - "$fixtures/recordings.json" "$work/recordings.json" "$mutation" <<'PY'
import json, sys
source, target, mutation = sys.argv[1:]
records = json.load(open(source))
if mutation == 'empty': records = []
elif mutation == 'duplicate': records.append(records[0])
elif mutation == 'request': records[0]['request']['state']['message'] = 'a different claim'
elif mutation == 'score': records[0]['score'] = 2
with open(target, 'w') as out: json.dump(records, out)
PY
    if pkl test -p hash="$hash" -p case="$work" "$here/Recordings.test.pkl" > "$work/result" 2>&1; then
        echo "unexpectedly accepted $mutation recordings" >&2
        exit 1
    fi
    echo "rejected $mutation recordings"
done
