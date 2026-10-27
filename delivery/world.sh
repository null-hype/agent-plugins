#!/usr/bin/env bash
# A world is a restic snapshot of everything registered-delivery judges:
#
#   plan-run/ work-run/   each run's witness run (priorities.json)
#   plan.json work.json   what witness showed on the spec, for each run
#   feature.spec.ts       the spec those answers are on the lines of
#   registered.json       the predictions as the judge read them
#   feature/              the dev container feature Jules wrote, when there is one
#
# Its tags are provenance: check=registered-delivery, label=<how it came to be:
# observed, synthetic, ...>, and run=<key> when it has one. The check selects
# a world by label, restores it apart from where it was made, and judges that.
#
#   RESTIC_REPOSITORY=... RESTIC_PASSWORD=... bash delivery/world.sh capture <dir> <label> [run]
#   bash delivery/world.sh judge <label>     # from jev-playwright
#
# Exits 0 when Jev agreed in a valid run, 1 when not (the verdict says which),
# 2 when no world has the label.
set -euo pipefail
: "${RESTIC_REPOSITORY:?the restic repository the worlds are in}"
: "${RESTIC_PASSWORD:?its password}"
check=registered-delivery
# One host, so worlds made in different containers are one group, as `restic
# forget --group-by host,paths,tags` sees them.
host=delivery

# The newest snapshot with the label, by its full id.
snapshot_of() {
  restic snapshots --tag "check=$check,label=$1" --json | jq -r 'sort_by(.time) | last | .id // empty'
}

capture_world() {
  local dir=$1 label=$2 run=${3:-} tags short
  for f in registered.json plan.json work.json feature.spec.ts plan-run work-run; do
    [ -e "$dir/$f" ] || { echo "$dir is not a world: no $f" >&2; exit 2; }
  done
  restic cat config > /dev/null 2>&1 || restic init >&2
  tags="check=$check,label=$label${run:+,run=$run}"
  short="$(restic backup "$dir" --host "$host" --tag "$tags" --json | jq -r 'select(.message_type == "summary").snapshot_id')"
  restic snapshots "$short" --json | jq -r '.[0].id'
}

judge_world() {
  local label=$1 id at world verdict
  id="$(snapshot_of "$label")"
  [ -n "$id" ] || { echo "no world labelled $label ($check) in $RESTIC_REPOSITORY" >&2; exit 2; }
  at="$(mktemp -d)"
  restic restore "$id" --target "$at" > /dev/null
  # restic restores under the directories above the world, as many as its version
  # keeps; the world is the shallowest directory holding registered.json.
  world="$(find "$at" -name registered.json -not -path '*/feature/*' -printf '%d %h\n' | sort -n | head -1 | cut -d' ' -f2-)"
  echo "World: $id ($(restic snapshots "$id" --json | jq -r '.[0].tags | join(", ")')), restored to $world"
  node delivery/facts.mjs "$world/feature.spec.ts" "$at/facts.json" \
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
}

case "${1:-}" in
  capture) shift; capture_world "$@" ;;
  judge) shift; judge_world "$@" ;;
  *) echo "usage: world.sh capture <dir> <label> [run] | judge <label>" >&2; exit 64 ;;
esac
