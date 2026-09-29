#!/bin/sh
# service.sh (control arm)
# Render an incoming note for display. Before rendering, rewrite any @include
# that names a path outside the note's own directory (an absolute path, or one
# containing a slash) to "[include refused]", so the expander only inlines
# sibling files. Differs from the positive service.sh only by this rewrite.
set -eu

: "${NOTE:=/inbox/note.txt}"

safe=$(mktemp)
sed -E 's#^@include (/|[^ ]*/).*#[include refused]#' "$NOTE" > "$safe"
exec /opt/toy/expander.sh "$safe"
