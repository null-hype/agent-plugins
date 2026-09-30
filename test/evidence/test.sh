#!/bin/bash

# Runs against an auto-generated devcontainer.json that includes the 'evidence' Feature.

set -e

source dev-container-features-test-lib

T="$(mktemp -d)"
mkdir -p "$T/root/app" "$T/outside"
printf 'Never pass untrusted input to run.sh.\n' > "$T/root/app/README.md"
printf 'secret\n' > "$T/outside/f.txt"
ln -s "$T/outside/f.txt" "$T/root/app/link.txt"

finding() { # source_path excerpt
    printf '{"findings":[{"component":"run.sh","source_path":"%s","excerpt":"%s","never":"untrusted input","enforced":false}]}' "$1" "$2"
}
finding app/README.md "Never pass untrusted input" > "$T/good.json"
finding app/README.md "Always pass untrusted input" > "$T/ungrounded.json"
finding app/missing.md "x" > "$T/missing.json"
finding ../outside/f.txt "secret" > "$T/escape.json"
finding app/link.txt "secret" > "$T/symlink.json"
echo '{"findings":[]}' > "$T/none.json"
echo '{"findings":[{"component":"run.sh"}]}' > "$T/malformed.json"
echo 'not json' > "$T/garbage.json"
echo '{"findings":[],"answer":0.9}' > "$T/extra-top.json"
echo '{"findings":[{"component":"a","source_path":"b","excerpt":"e","never":"n","enforced":false,"x":1}]}' > "$T/extra-key.json"
echo '{"findings":[{"component":"a","source_path":"b","excerpt":"","never":"n","enforced":false}]}' > "$T/empty-str.json"
echo '{"findings":[{"component":"a","source_path":"b","excerpt":"e","never":"n","enforced":"yes"}]}' > "$T/wrong-type.json"
echo '[]' > "$T/not-object.json"

check "pkl runtime installed" bash -c "pkl --version"
check "Evidence.pkl installed" test -f /usr/local/share/evidence/pkl/Evidence.pkl
check "Scenario.pkl installed" test -f /usr/local/share/evidence/pkl/Scenario.pkl
check "adapter installed" test -f /usr/local/share/evidence/lib/evidence_contract.py
check "valid evidence passes" evidence-validate "$T/good.json"
check "no findings is valid" evidence-validate "$T/none.json"
check "grounded excerpt passes" evidence-validate --root "$T/root" "$T/good.json"
check "no findings is grounded" evidence-validate --root "$T/root" "$T/none.json"
check "malformed evidence rejected" bash -c "! evidence-validate '$T/malformed.json'"
check "non-JSON rejected" bash -c "! evidence-validate '$T/garbage.json'"
check "extra top-level key rejected" bash -c "! evidence-validate '$T/extra-top.json'"
check "extra finding key rejected" bash -c "! evidence-validate '$T/extra-key.json'"
check "empty string rejected" bash -c "! evidence-validate '$T/empty-str.json'"
check "wrong type rejected" bash -c "! evidence-validate '$T/wrong-type.json'"
check "non-object rejected" bash -c "! evidence-validate '$T/not-object.json'"
check "malformed rejected even with --root" bash -c "! evidence-validate --root '$T/root' '$T/malformed.json'"
check "excerpt not in file rejected" bash -c "! evidence-validate --root '$T/root' '$T/ungrounded.json'"
check "missing source file rejected" bash -c "! evidence-validate --root '$T/root' '$T/missing.json'"
check "path escaping root rejected" bash -c "! evidence-validate --root '$T/root' '$T/escape.json'"
check "symlink out of root rejected" bash -c "! evidence-validate --root '$T/root' '$T/symlink.json'"

reportResults
