#!/bin/sh
# Exit 3 only when this session cannot resolve the scenario's Claude credential.
# A transport, authentication, or child-process failure fails normally.
error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT
if pass-cli run "$@" 2>"$error_file"; then
    cat "$error_file" >&2
    exit 0
else
    status=$?
    cat "$error_file" >&2
    if grep -Fq 'Failed to retrieve item claude from share anthropic.ai' "$error_file" &&
       grep -Eq 'Could not find vault anthropic\.ai|Could not find item with name claude' "$error_file"; then
        echo "Claude credential unavailable to this Proton Pass session; skipping the Claude check." >&2
        exit 3
    fi
    # Reserve 3 for credential unavailability, even if a child returns 3.
    [ "$status" -ne 3 ] || status=1
    exit "$status"
fi
