#!/usr/bin/env bash
# judge.sh through the world store, against a disposable restic repository and the fixture worlds in
# worlds/ (run 7 and the first passing run, rebuilt from the scores the check
# printed, so synthetic). Needs restic, jq, node and pkl.
#
#   bash delivery/judge.test.sh    # from the repo root
set -uo pipefail
cd "$(dirname "$0")/.."
export RESTIC_REPOSITORY="$(mktemp -d)" RESTIC_PASSWORD=test WORLD_CHECK=registered-delivery
store="bash world/world.sh"
world="bash delivery/judge.sh"
fails=0
ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }

# Capturing a completed world, tagged.
id7="$($store capture delivery/worlds/run7 synthetic run7)"
ok "a captured world has an id" '[ -n "$id7" ]'
ok "it is tagged with the check, its label and its run" \
  '[ "$(restic snapshots "$id7" --json | jq -c ".[0].tags | sort")" = "[\"check=registered-delivery\",\"label=synthetic\",\"run=run7\"]" ]'

# Selecting by label.
ok "no world has the label observed yet" '[ -z "$(restic snapshots --tag check=registered-delivery,label=observed --json | jq -r ".[]?.id")" ]'
$world observed > /dev/null 2>&1; code=$?
ok "judging a label no world has exits 2" '[ "$code" = 2 ]'
idp="$($store capture delivery/worlds/first-passing agreeing)"
ok "another label selects another world" '[ "$idp" != "$id7" ]'

# Restoring and evaluating it; run 7 as the pkl test has it.
out="$(VERDICT="$(mktemp -d)/verdict.json" $world synthetic 2>&1)"; code=$?
ok "run 7 through its snapshot is a valid finding: Jev disagreement" 'grep -q "^Verdict: valid finding: Jev disagreement" <<< "$out"'
ok "and exits 1 for it" '[ "$code" = 1 ]'
ok "the output names the world it judged" 'grep -q "^World: $id7 " <<< "$out"'
ok "its movements are run 7's" 'grep -q "  0.02  Create .src/witness/devcontainer-feature.json" <<< "$out" && grep -q "  -0.09  Create .src/witness/install.sh" <<< "$out"'

# The same check on another world.
out="$($world agreeing 2>&1)"; code=$?
ok "the first passing run through its snapshot is a valid finding: Jev agreement" 'grep -q "^Verdict: valid finding: Jev agreement" <<< "$out" && [ "$code" = 0 ]'

# An exact id judges exactly that world, whatever is newer under its label.
idn="$($store capture delivery/worlds/first-passing synthetic)"
out="$($world "$id7" 2>&1)"
ok "an id judges that snapshot, not the newest with its label" 'grep -q "^World: $id7 " <<< "$out" && grep -q "^Verdict: valid finding: Jev disagreement" <<< "$out"'

# The snapshot is the world: what it was made from can change.
cp -r delivery/worlds/run7 "$RESTIC_REPOSITORY.src" && $store capture "$RESTIC_REPOSITORY.src" mutable > /dev/null
rm -rf "$RESTIC_REPOSITORY.src"
out="$($world mutable 2>&1)"
ok "a world is judged from its snapshot, not from where it was made" 'grep -q "^Verdict: valid finding: Jev disagreement" <<< "$out"'

echo; [ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
