#!/bin/bash

# CIT-286 deterministic contract scenario (global): reasoning model -> Jev.
#
# Runs inside a container built by 'devcontainer features test' from the
# 'cit-286-contract' entry in test/_global/scenarios.json, which installs the
# two reusable METHOD features together:
#     evidence  (evidence-validate: schema + grounding)   -- CIT-284
#     jev       (jev: the Noul-judge client)               -- CIT-289
#
#    devcontainer features test --global-scenarios-only .
#
# This scenario proves the CONTRACT SEAMS with canned evidence and jev's mock
# backend only -- no real agent, no network, no API key (Rule M1 of the
# devcontainer-feature-testing skill). It is deterministic and credential-free.
#
# It is fully self-contained (skill Rule S): every fixture and the grounding
# root are generated at runtime with heredocs into a mktemp dir; nothing is read
# from the checkout (no docs/, no ../src). It carries NO CVE/case data and no
# hint sweeps (skill Rule D2): the evidence here is a generic "never / enforced"
# record and the questions are generic Noul questions.
#
# Rules applied (see .claude/skills/devcontainer-feature-testing/SKILL.md):
#   T  - assert the installed bins (evidence-validate, jev) inside the container
#   S  - self-contained fixtures via heredocs
#   C1 - format valid, "no findings" valid
#   C2 - grounding: verbatim excerpt at source_path under the image root
#   C3 - isolation: init-event manifest has filesystem tools, no web tools
#   C4 - jev returns one finite probability in [0,1] per question
#   C5 - malformed/ungrounded evidence rejected BEFORE jev, invocation observable
#   D2 - no case data in the method features exercised here

set -e

source dev-container-features-test-lib

T="$(mktemp -d)"

# --- Observable Jev-invocation seam (Rule C5) ------------------------------
# A wrapper named 'jev' placed first on PATH appends one line to $JEV_CALLS on
# every real invocation, then delegates to the installed jev. The pipeline
# below is the ONLY thing that decides whether jev runs; the log is how the
# test observes it, rather than trusting an exit code alone.
REAL_JEV="$(command -v jev)"
export JEV_CALLS="$T/jev-calls.log"
: > "$JEV_CALLS"
mkdir -p "$T/shim"
cat > "$T/shim/jev" <<EOF
#!/bin/bash
echo "invoked \$*" >> "$JEV_CALLS"
exec "$REAL_JEV" "\$@"
EOF
chmod +x "$T/shim/jev"
export PATH="$T/shim:$PATH"

jev_calls() { wc -l < "$JEV_CALLS" | tr -d ' '; }

# The method pipeline: validate the agent's evidence (schema + grounding), and
# ONLY on success send the fixture state to jev. This is the reject-before-Jev
# seam; jev is never reached when validation fails.
contract() { # <evidence-file> <image-root> <fixture> <questions> <mock-answers>
    evidence-validate --root "$2" "$1" || return 1
    jev --backend mock --mock-answers "$5" -q "$4" "$3"
}

# Exported so the dev-container-features-test-lib 'check' helper's child bash -c
# invocations below inherit them (bash exports functions via the environment).
export -f jev_calls contract

# --- Grounding root: files at real paths, an excerpt present verbatim -------
mkdir -p "$T/root/app"
printf 'Never pass untrusted input to run.sh.\n' > "$T/root/app/README.md"

# --- Canned evidence (generic; no CVE/case data) ----------------------------
finding() { # <source_path> <excerpt>
    printf '{"findings":[{"component":"run.sh","source_path":"%s","excerpt":"%s","never":"untrusted input","enforced":false}]}' "$1" "$2"
}
finding app/README.md "Never pass untrusted input" > "$T/good.json"       # grounded
finding app/README.md "Always pass untrusted input" > "$T/ungrounded.json" # excerpt not in file
echo '{"findings":[]}'                               > "$T/none.json"       # no findings
echo '{"findings":[{"component":"run.sh"}]}'         > "$T/malformed.json"  # missing keys

# --- Fixture + questions + canned Jev answers -------------------------------
cat > "$T/fixture.json" <<'EOF'
{ "state": { "diff_items": [ { "component": "run.sh", "kind": "modified" } ],
             "files": { "run.sh": "runs input unchanged" } } }
EOF
cat > "$T/questions.json" <<'EOF'
{ "a02_security_misconfiguration": { "type": "noul",
    "instructions": "Does the resulting system contain an insecure default?" } }
EOF
echo '{"a02_security_misconfiguration": 0.83}' > "$T/ans.json"
echo '{"a02_security_misconfiguration": 1.5}'  > "$T/ans-bad.json"

# --- C3 isolation manifest (canned init event) ------------------------------
# Deterministic stand-in for the live harness's recorded init event: the run
# offers filesystem tools and NO web tools. The real manifest comes from the
# CIT-271 runner; this asserts the contract shape the runner must satisfy.
cat > "$T/init-event.json" <<'EOF'
{ "type": "init",
  "tools": ["read_file", "list_directory", "grep", "glob"],
  "disallowed": ["web_fetch", "web_search"] }
EOF

# ---------------------------------------------------------------------------
# Feature installation (Rule T): the bins exist in the container.
check "evidence-validate is on PATH" bash -c "command -v evidence-validate"
check "jev is on PATH"               bash -c "jev --help >/dev/null"
check "evidence schema installed"    test -f /usr/local/share/evidence/evidence.schema.json

# C1 - format: valid record and "no findings" both pass the schema.
check "C1 valid evidence passes format"  evidence-validate "$T/good.json"
check "C1 no-findings is valid format"   evidence-validate "$T/none.json"
check "C1 malformed evidence fails format" bash -c "! evidence-validate '$T/malformed.json'"

# C2 - grounding against the image root.
check "C2 grounded excerpt passes"       evidence-validate --root "$T/root" "$T/good.json"
check "C2 no-findings is grounded"       evidence-validate --root "$T/root" "$T/none.json"
check "C2 ungrounded excerpt rejected"   bash -c "! evidence-validate --root '$T/root' '$T/ungrounded.json'"

# C3 - isolation manifest: filesystem tools present, web tools absent.
check "C3 init event offers a filesystem tool" \
    bash -c "grep -Eq '\"(read_file|list_directory|grep|glob)\"' '$T/init-event.json'"
check "C3 init event offers no web tools" \
    python3 -c "import json,sys; t=json.load(open('$T/init-event.json')).get('tools',[]); sys.exit(0 if t and not any('web' in str(x).lower() for x in t) else 1)"

# C4 - Jev accepts valid grounded evidence: one probability in [0,1] per
# question, and the accept path DOES invoke jev (observable seam, positive side).
: > "$JEV_CALLS"
check "C4 valid+grounded reaches jev and returns a probability" bash -c "
    contract '$T/good.json' '$T/root' '$T/fixture.json' '$T/questions.json' '$T/ans.json' \
      | grep -q '\"a02_security_misconfiguration\": 0.83'"
check "C4 jev WAS invoked on the accept path (>=1 call)" bash -c "test \"\$(jev_calls)\" -ge 1"
check "C4 no-findings also reaches jev" bash -c "
    : > '$JEV_CALLS'
    contract '$T/none.json' '$T/root' '$T/fixture.json' '$T/questions.json' '$T/ans.json' >/dev/null
    test \"\$(jev_calls)\" -ge 1"
check "C4 out-of-range probability rejected by jev" bash -c "
    ! jev --backend mock --mock-answers '$T/ans-bad.json' -q '$T/questions.json' '$T/fixture.json'"

# C5 - reject BEFORE Jev, with the invocation observably NOT happening.
check "C5 malformed evidence: contract fails" bash -c "
    : > '$JEV_CALLS'
    ! contract '$T/malformed.json' '$T/root' '$T/fixture.json' '$T/questions.json' '$T/ans.json'"
check "C5 malformed evidence: jev NOT invoked (0 calls)" bash -c "test \"\$(jev_calls)\" -eq 0"
check "C5 ungrounded evidence: contract fails" bash -c "
    : > '$JEV_CALLS'
    ! contract '$T/ungrounded.json' '$T/root' '$T/fixture.json' '$T/questions.json' '$T/ans.json'"
check "C5 ungrounded evidence: jev NOT invoked (0 calls)" bash -c "test \"\$(jev_calls)\" -eq 0"

reportResults
