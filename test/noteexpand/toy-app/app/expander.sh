#!/bin/sh
# expander.sh FILE
# Write FILE to stdout. A line "@include PATH" is replaced by the contents of
# the file at PATH. Behaviour is described in README.md.
set -eu

file=${1:?usage: expander.sh FILE}

while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        "@include "*)
            path=${line#@include }
            cat "$path"
            ;;
        *)
            printf '%s\n' "$line"
            ;;
    esac
done < "$file"
