#!/usr/bin/env bash
# A world is a restic snapshot of a directory a producer made and a judge reads.
# This keeps worlds and knows nothing of what is in them: it captures a
# directory, selects a snapshot by exact id or by label, and restores it apart
# from where it was made.
#
# Its tags are provenance: check=<WORLD_CHECK>, label=<how it came to be:
# observed, synthetic, ...>, and run=<key> when it has one. Snapshots are
# kept under one host, so worlds made in different containers are one group.
#
#   export RESTIC_REPOSITORY=... RESTIC_PASSWORD=... WORLD_CHECK=<what judges it>
#   bash world/world.sh capture <dir> <label> [run]   # prints the snapshot's exact id
#   bash world/world.sh restore <id | label>           # prints where it was restored
#
# restore given an id restores exactly that snapshot; given a label, the newest
# world with it. It names the world on stderr. Exit 2 when there is no such world.
set -euo pipefail
: "${RESTIC_REPOSITORY:?the restic repository the worlds are in}"
: "${RESTIC_PASSWORD:?its password}"
: "${WORLD_CHECK:?what judges the worlds (the check= tag)}"
host=world

# The snapshot: a full id as it is, or the newest with the label, by its full id.
snapshot_of() {
  if [[ $1 =~ ^[0-9a-f]{64}$ ]]; then
    restic snapshots "$1" --json | jq -r '.[0].id // empty'
    return
  fi
  restic snapshots --tag "check=$WORLD_CHECK,label=$1" --json | jq -r 'sort_by(.time) | last | .id // empty'
}

capture_world() {
  local dir=$1 label=$2 run=${3:-} tags short
  [ -n "$(ls -A "$dir" 2>/dev/null)" ] || { echo "$dir is not a world: it is empty or missing" >&2; exit 2; }
  restic cat config > /dev/null 2>&1 || restic init >&2
  tags="check=$WORLD_CHECK,label=$label${run:+,run=$run}"
  short="$(restic backup "$dir" --host "$host" --tag "$tags" --json | jq -r 'select(.message_type == "summary").snapshot_id')"
  restic snapshots "$short" --json | jq -r '.[0].id'
}

restore_world() {
  local id at world
  id="$(snapshot_of "$1")"
  [ -n "$id" ] || { echo "no world $1 ($WORLD_CHECK) in $RESTIC_REPOSITORY" >&2; exit 2; }
  at="$(mktemp -d)"
  # restic restores under the target at the path the world was backed up from,
  # less as many leading components as its version drops: the world is the
  # longest tail of that path that is there.
  restic restore "$id" --target "$at" > /dev/null
  world="$(restic snapshots "$id" --json | jq -r '.[0].paths[0]')"
  until [ -d "$at$world" ]; do
    [[ $world == /*/* ]] || { echo "world $id restored nowhere under $at" >&2; exit 1; }
    world="/${world#/*/}"
  done
  world="$at$world"
  echo "World: $id ($(restic snapshots "$id" --json | jq -r '.[0].tags | join(", ")')), restored to $world" >&2
  echo "$id $world"
}

case "${1:-}" in
  capture) shift; capture_world "$@" ;;
  restore) shift; restore_world "$@" ;;
  *) echo "usage: world.sh capture <dir> <label> [run] | restore <id|label>" >&2; exit 64 ;;
esac
