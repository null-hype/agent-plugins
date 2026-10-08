#!/bin/bash
# Runs CIT-294's four arms (mat x {unblocked,blocked}, png x {unblocked,blocked})
# against the cit294:live image and regenerates this directory's committed
# evidence: canary-reads.txt (strace transcripts), observations/*.json
# (canary_runner.rb's own structured output, merged with the
# `independent_*` evidence this script derives on its own -- see
# Observation.pkl), and reports/ (the actual `pkl test`/diagnose.pkl output
# CIT-297 asked be retained, not just narrated in prose). See ../CIT-294.md.
#
#   cd ..  && docker build -f cit-294/Dockerfile -t cit294:live .   # from CIT-265/
#   cd cit-294 && ./run_arms.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p observations reports

IMAGE="cit294:live"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
# Read live rather than transcribed by hand -- `config.load_defaults` has no
# runtime reader, so it's grepped from the app's own committed config file
# inside the pinned image; `variant_processor` does have a live reader.
LOAD_DEFAULTS="$(docker run --rm "$IMAGE" grep -o 'load_defaults [0-9.]*' config/application.rb | awk '{print $2}')"
VARIANT_PROCESSOR="$(docker run --rm "$IMAGE" bin/rails runner 'puts Rails.application.config.active_storage.variant_processor' 2>/dev/null)"

run_arm() {
  local input="$1" block="$2" label="$3"
  local envs=(-e CIT294_INPUT="$input")
  [ -n "$block" ] && envs+=(-e VIPS_BLOCK_UNTRUSTED="$block")
  local source_path
  source_path="$([ "$input" = mat ] && echo /work/canary.mat || echo /work/control.png)"

  echo "### ARM: $label"
  echo "== strace openat evidence for the canary/control file =="
  local raw
  raw="$(mktemp)"
  docker run --rm "${envs[@]}" "$IMAGE" \
    strace -f -e trace=openat -y bin/rails runner /work/canary_runner.rb \
    > "$raw" 2>&1
  grep -E "dummy-canary\.txt|canary\.mat|control\.png" "$raw" \
    || echo "  (no openat of the canary/control file observed)"

  # Independent evidence: computed from the strace transcript and from the
  # pinned image directly -- nothing here comes from canary_runner.rb's own
  # stdout, so a tampered or absent self-report can't also fake this half
  # (CIT-297).
  local dummy_count source_sha256
  dummy_count="$(grep -cE 'openat\(.*"/work/dummy-canary\.txt"' "$raw" || true)"
  source_sha256="$(docker run --rm "$IMAGE" sha256sum "$source_path" | awk '{print $1}')"

  echo "== script JSON result =="
  local script_json
  script_json="$(sed -n '/^{$/,/^}$/p' "$raw")"
  jq --argjson dummy_count "$dummy_count" \
     --arg source_sha256 "$source_sha256" \
     --arg image_id "$IMAGE_ID" \
     --arg load_defaults "$LOAD_DEFAULTS" \
     --arg variant_processor "$VARIANT_PROCESSOR" \
     '. + {
       independent_dummy_file_openat_count: $dummy_count,
       independent_source_sha256: $source_sha256,
       independent_image_id: $image_id,
       independent_rails_load_defaults: $load_defaults,
       independent_active_storage_variant_processor: $variant_processor
     }' <<<"$script_json" | tee "observations/${label}.json"
  echo
  rm -f "$raw"
}

{
  run_arm mat ""  "mat-unblocked"
  run_arm mat "1" "mat-blocked"
  run_arm png ""  "png-unblocked"
  run_arm png "1" "png-blocked"
} | tee canary-reads.txt

echo "== actual detector output (Reconcile.check per arm) =="
pkl eval -f json diagnose.pkl -o reports/diagnostics.json
cat reports/diagnostics.json

echo "== authoritative check results (pkl test) =="
pkl test --junit-reports reports cit294.test.pkl
