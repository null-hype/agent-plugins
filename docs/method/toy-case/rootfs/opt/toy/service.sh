#!/bin/sh
# service.sh
# Render an incoming note for display. The note path comes from $NOTE (a note
# received from a caller); its expanded form is written to stdout.
set -eu

: "${NOTE:=/inbox/note.txt}"
exec /opt/toy/expander.sh "$NOTE"
