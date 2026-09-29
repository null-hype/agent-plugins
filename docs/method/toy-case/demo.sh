#!/bin/sh
# Demonstrate that the toy's stated "never" is unenforced in the positive image
# and enforced in the control image. Harmless canary -- the referenced file
# holds a MARKER string, not a secret, and the read is observed directly in the
# output. Analogue of the CIT-278 canary, but self-contained and CVE-free.
#
# Drives the built IMAGES (not the checkout scripts): the note is fed on stdin
# and the marker is created inside the container at runtime, so nothing about
# the probe is baked into the image root and no host bind mount is involved
# (the /tmp bind-mount trap the CIT-271 README documents). Builds both targets
# if they are not already present.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
POS=${POS_IMAGE:-toy-noteexpand:positive}
CTL=${CTL_IMAGE:-toy-noteexpand:control}
MARKER=MARKER-8f3a

docker build -q --target positive -t "$POS" "$here" >/dev/null
docker build -q --target control  -t "$CTL" "$here" >/dev/null

# A note the caller did not author: an @include of a file OUTSIDE the note's
# own directory (absolute path), plus plain lines that must render in both arms.
note="hello
@include /tmp/o/marker.txt
bye"

# Create the marker and the note inside the container, then render via service.sh.
run_arm() { # image
    printf '%s\n' "$note" | docker run --rm -i "$1" sh -c '
        set -eu
        mkdir -p /tmp/o /tmp/n
        printf "%s\n" "MARKER-8f3a" > /tmp/o/marker.txt
        cat > /tmp/n/note.txt
        NOTE=/tmp/n/note.txt /opt/toy/service.sh
    '
}

echo "== positive arm ($POS) =="
pos=$(run_arm "$POS"); printf '%s\n' "$pos"
echo
echo "== control arm ($CTL) =="
ctl=$(run_arm "$CTL"); printf '%s\n' "$ctl"
echo

fail=0
# Plain lines must render in BOTH arms (guards against an empty run passing).
for arm in "pos:$pos" "ctl:$ctl"; do
    name=${arm%%:*}; out=${arm#*:}
    if printf '%s' "$out" | grep -q '^hello$' && printf '%s' "$out" | grep -q '^bye$'; then
        echo "$name: plain lines rendered -- OK"
    else
        echo "$name: plain lines missing -- UNEXPECTED (empty/failed run?)" >&2; fail=1
    fi
done
# The marker distinguishes the arms.
if printf '%s' "$pos" | grep -q "$MARKER"; then
    echo "positive: MARKER read (unenforced 'never' fires) -- OK"
else
    echo "positive: MARKER not read -- UNEXPECTED" >&2; fail=1
fi
if printf '%s' "$ctl" | grep -q "$MARKER"; then
    echo "control: MARKER read -- UNEXPECTED (control should refuse)" >&2; fail=1
else
    echo "control: MARKER refused ('never' enforced) -- OK"
fi
exit $fail
