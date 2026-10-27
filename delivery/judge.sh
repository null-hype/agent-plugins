#!/usr/bin/env bash
# registered-delivery's judge: restores a world from the store (an exact
# snapshot id, or a label for the newest with it) and judges it with
# Reconcile.pkl. The store knows nothing of this.
#
#   bash delivery/judge.sh <snapshot id | label>     # from the repo root
#
# Exits 0 when Jev agreed in a valid run, 1 when not (the verdict says which),
# 2 when no world has the label.
set -euo pipefail
export WORLD_CHECK=registered-delivery
restored="$(bash world/world.sh restore "$1")" || exit $?
read -r id world <<< "$restored"
at="$(mktemp -d)"
node delivery/facts.mjs "$world/spec.txt" "$at/facts.json" \
  "plan=$world/plan.json,$world/plan-run" "work=$world/work.json,$world/work-run"
pkl eval -f json -p observed="file://$at/facts.json" -p registered="file://$world/registered.json" \
  delivery/Reconcile.pkl > "$at/pkl.json"
# The verdict names the world it judged, so it can be had again.
verdict="${VERDICT:-$at/verdict.json}"
jq --arg id "$id" '. + {world: $id}' "$at/pkl.json" > "$verdict"
jq -r '"Registered: " + .registration' "$verdict"
for layer in "installed the world" "protocol the protocol" "measured Jev"; do
  echo "${layer#* }:"
  jq -r --arg k "${layer%% *}" '.[$k] | to_entries[] | "  " + (if .value then "✓ " else "✗ " end) + .key' "$verdict"
done
jq -r '.movements | to_entries[] | "  \(.value * 100 | round / 100)  \(.key)"' "$verdict"
jq -r '"Verdict: " + .verdict' "$verdict"
jq -r '"Next: " + .next' "$verdict"
jq -e .pass "$verdict" > /dev/null || { jq -r '.verdict + " [world " + .world + "]"' "$verdict" >&2; exit 1; }
