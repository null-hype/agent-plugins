#!/bin/sh
# Prints how many lines each file argument has.
for f in "$@"; do
    printf '%s %s\n' "$(wc -l < "$f")" "$f"
done
