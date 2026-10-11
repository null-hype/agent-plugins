#!/usr/bin/env bash
# CIT-399: send each pinned payload to Jev and print recordings.json:
# [{digest, score, request}], the request being what jev actually sent.
#
#   ask.sh <payloads>     (from `pkl eval -m <payloads> Payloads.pkl`;
#                          jev on $JEV, TYPESAFE_API_KEY set)
set -euo pipefail
payloads=$1
jev=${JEV:-jev}
work=$(mktemp -d)
sep=
echo "["
for dir in "$payloads"/*/; do
  hex=$(basename "$dir")
  "$jev" -q "$dir/questions.json" --request-out "$work/request.json" "$dir/payload.json" > "$work/answer.json"
  score=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["probabilities"]["claim"])' "$work/answer.json")
  echo "$sep{\"digest\": \"sha256:$hex\", \"score\": $score, \"request\": $(cat "$work/request.json")}"
  sep=,
done
echo "]"
rm -rf "$work"
