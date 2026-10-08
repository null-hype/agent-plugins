#!/bin/bash
# Runs CIT-294's four arms (mat x {unblocked,blocked}, png x {unblocked,blocked})
# against the cit294:live image and regenerates this directory's committed
# evidence: canary-reads.txt (strace transcripts) and observations/*.json
# (canary_runner.rb's own structured output per arm). See ../CIT-294.md.
#
#   cd ..  && docker build -f cit-294/Dockerfile -t cit294:live .   # from CIT-265/
#   cd cit-294 && ./run_arms.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p observations

run_arm() {
  local input="$1" block="$2" label="$3"
  local envs=(-e CIT294_INPUT="$input")
  [ -n "$block" ] && envs+=(-e VIPS_BLOCK_UNTRUSTED="$block")
  echo "### ARM: $label"
  echo "== strace openat evidence for the canary/control file =="
  local raw
  raw="$(mktemp)"
  docker run --rm "${envs[@]}" cit294:live \
    strace -f -e trace=openat -y bin/rails runner /work/canary_runner.rb \
    > "$raw" 2>&1
  grep -E "dummy-canary\.txt|canary\.mat|control\.png" "$raw" \
    || echo "  (no openat of the canary/control file observed)"
  echo "== script JSON result =="
  sed -n '/^{$/,/^}$/p' "$raw" | tee "observations/${label}.json" >/dev/null
  cat "observations/${label}.json"
  echo
  rm -f "$raw"
}

{
  run_arm mat ""  "mat-unblocked"
  run_arm mat "1" "mat-blocked"
  run_arm png ""  "png-unblocked"
  run_arm png "1" "png-blocked"
} | tee canary-reads.txt
