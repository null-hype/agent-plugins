#!/bin/bash

# Scenario: 'jev' installed alongside 'pass-cli'. Proves the two features
# compose in one container -- the composition point being that pass-cli wraps
# the secret for jev's real backend (`pass-cli run --env-file ... -- jev ...`).
# This scenario is credential-free: it exercises jev's mock backend and only
# checks that both features' bins coexist, so it needs no live Proton Pass token.

set -e

source dev-container-features-test-lib

T="$(mktemp -d)"
cat > "$T/fixture.json" <<'EOF'
{ "state": { "diff_items": [], "files": {} } }
EOF
cat > "$T/questions.json" <<'EOF'
{ "a02_security_misconfiguration": { "type": "noul", "instructions": "insecure default?" } }
EOF
echo '{"a02_security_misconfiguration": 0.5}' > "$T/ans.json"

check "jev is on PATH" bash -c "jev --help >/dev/null"
check "pass-cli's 'color' bin is on PATH (feature composed in)" bash -c "command -v color"
check "first-party jev skill installed" bash -c "test -f \$HOME/.claude/skills/jev/SKILL.md"
check "jev mock run works alongside pass-cli" bash -c "jev --backend mock --mock-answers '$T/ans.json' -q '$T/questions.json' '$T/fixture.json' | grep -q '\"backend\": \"mock\"'"

reportResults
