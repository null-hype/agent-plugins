#!/usr/bin/env bash
# world.sh against a disposable restic repository and a world of no particular
# kind: the store keeps any directory. Needs restic and jq.
#
#   bash world/world.test.sh    # from the repo root
set -uo pipefail
cd "$(dirname "$0")/.."
export RESTIC_REPOSITORY="$(mktemp -d)" RESTIC_PASSWORD=test WORLD_CHECK=anything
world="bash world/world.sh"
fails=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }

src="$(mktemp -d)"; mkdir -p "$src/nested"; echo one > "$src/a.txt"; echo deep > "$src/nested/b.txt"
id1="$($world capture "$src" first run1)"
ok "a captured world has a full id" '[[ $id1 =~ ^[0-9a-f]{64}$ ]]'
ok "it is tagged with the check, its label and its run" \
  '[ "$(restic snapshots "$id1" --json | jq -c ".[0].tags | sort")" = "[\"check=anything\",\"label=first\",\"run=run1\"]" ]'
ok "an empty directory is not a world" '! $world capture "$(mktemp -d)" first 2> /dev/null'

read -r got at <<< "$($world restore first 2> /dev/null)"
ok "a label restores the world as the root of a fresh directory" '[ "$got" = "$id1" ] && [ "$(cat "$at/a.txt")" = one ] && [ "$(cat "$at/nested/b.txt")" = deep ]'
ok "the restore is apart from where it was made" '[ "$at" != "$src" ]'

echo two > "$src/a.txt"
id2="$($world capture "$src" first)"
read -r got at <<< "$($world restore first 2> /dev/null)"
ok "a label selects the newest world with it" '[ "$got" = "$id2" ] && [ "$(cat "$at/a.txt")" = two ]'
read -r got at <<< "$($world restore "$id1" 2> /dev/null)"
ok "an id restores exactly that world, whatever is newer" '[ "$got" = "$id1" ] && [ "$(cat "$at/a.txt")" = one ]'
$world restore nothing > /dev/null 2>&1; code=$?
ok "a label no world has exits 2" '[ "$code" = 2 ]'
WORLD_CHECK=another $world restore first > /dev/null 2>&1; code=$?
ok "worlds of another check are not selected" '[ "$code" = 2 ]'

echo; [ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
