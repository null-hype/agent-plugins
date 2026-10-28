#!/usr/bin/env bash
# Sets up the delivery agents in Proton Pass. Each agent has its own vault,
# starting with one credential, and can read nothing it is not meant to call:
#
#   root     jev-root      claude-code   CLAUDE_CODE_OAUTH_TOKEN   the harness: starts the planner
#                          planner-token the planner's Pass token
#   planner  jev-planner   jules         JULES_API_KEY             dispatches to Jules
#                          journal       goal, plan                written before any work
#   worker   jev-worker    typesafe      TYPESAFE_API_KEY          Jules's: copied into Jules by hand
#   judge    jev-judge     typesafe      TYPESAFE_API_KEY          the final verdict
#                          journal       verdict
#
# Each token is a Pass agent, so `pass-cli agent monitor` shows what it read,
# and is editor on its own vault. The judge can also view the planner's
# journal, and nothing else of anyone's. Run it logged in as yourself; re-running
# reuses what exists.
#
#   bash delivery/bootstrap.sh
set -euo pipefail

PREFIX="${PREFIX:-jev}"
EXPIRATION="${EXPIRATION:-3m}"   # 1d, 1w, 1m, 3m, 6m or 1y: 3m is three months
REPO="${REPO:-null-hype/agent-plugins}"

die() { echo "bootstrap: $*" >&2; exit 1; }
command -v pass-cli >/dev/null 2>&1 || die "pass-cli is required"
command -v jq >/dev/null 2>&1 || die "jq is required"

# `personal-access-token list` is refused in a token session, so it doubles as the owner check.
pass-cli personal-access-token list --output json >/dev/null 2>&1 ||
  die "run it logged in as yourself, not as a token: pass-cli login"
export PROTON_PASS_AGENT_REASON="bootstrap the $PREFIX delivery agents"

vault() { printf '%s-%s' "$PREFIX" "$1"; }

vault_exists() {
  pass-cli vault list --output json | jq -e --arg n "$1" '.. | objects | select(.name? == $n)' >/dev/null
}
item_exists() {
  pass-cli item list "$1" --output json |
    jq -e --arg t "$2" '.. | objects | select((.title? == $t) or (.content?.title? == $t))' >/dev/null
}
agent_exists() {
  pass-cli agent list --output json | jq -e --arg n "$1" '.. | objects | select(.name? == $n)' >/dev/null
}

ensure_vault() {
  if vault_exists "$1"; then echo "vault exists: $1"; else echo "creating vault: $1"; pass-cli vault create --name "$1"; fi
}

# A custom item with fixed fields: `item update` edits a field but cannot add one.
create_item() { # vault title type field=value...
  local vault="$1" title="$2" type="$3"; shift 3
  printf '%s\n' "$@" |
    jq -R --arg type "$type" 'capture("^(?<field_name>[^=]+)=(?<value>.*)$") + {field_type: $type}' |
    jq -s --arg title "$title" '{title: $title, note: "", sections: [{section_name: $title, fields: .}]}' |
    pass-cli item create custom --vault-name "$vault" --from-template - >/dev/null
}

# A starting credential, asked for once and never echoed.
ensure_credential() { # vault title field prompt
  if item_exists "$1" "$2"; then echo "credential exists: $1/$2"; return; fi
  local value
  read -rsp "$4: " value; echo
  [[ -n "$value" ]] || die "no value for $1/$2"
  create_item "$1" "$2" hidden "$3=$value"
  echo "stored: $1/$2/$3"
}

ensure_journal() { # vault field...
  local vault="$1"; shift
  if item_exists "$vault" journal; then echo "journal exists: $vault/journal"; return; fi
  create_item "$vault" journal text "${@/%/=}"
  echo "created journal: $vault/journal"
}

# An agent's token is printed once, by `agent create`, so it is kept as it is made.
token="" # set by ensure_token when it creates one
ensure_token() { # name
  token=""
  if agent_exists "$1"; then echo "token exists: $1"; return; fi
  echo "creating token: $1"
  token="$(pass-cli agent create "$1" --expiration "$EXPIRATION" | jq -r '.token // empty')"
  [[ -n "$token" ]] || die "agent create printed no token for $1"
}

# Granting again sets the role, and "already granted" is not an error.
grant() { # token role scope...
  local name="$1" role="$2" err; shift 2
  err="$(mktemp)"
  if pass-cli agent access grant "$name" "$@" --role "$role" 2>"$err" ||
    grep -Eqi 'already|duplicate' "$err"; then
    rm -f "$err"; echo "granted: $name $role $*"; return 0
  fi
  cat "$err" >&2; rm -f "$err"; return 1
}

# The token is shown nowhere else, so one gh cannot set is kept in the owner's
# vault, which no agent can read, to be set by hand from there.
ci_secret() { # name value
  if [[ -z "$2" ]]; then return; fi
  if command -v gh >/dev/null 2>&1 && printf '%s' "$2" | gh secret set "$1" --repo "$REPO"; then
    echo "CI secret set: $1"
  elif item_exists "$owner" "$1"; then
    die "$owner/$1 exists but its token was just created: delete that item and run again"
  else
    create_item "$owner" "$1" hidden "$1=$2"
    echo "could not set the CI secret $1: stored in $owner/$1 for you to set"
  fi
}

root="$(vault root)" planner="$(vault planner)" worker="$(vault worker)" judge="$(vault judge)"
owner="$(vault owner)"

# 1. One vault per agent, and the owner's.
for v in "$root" "$planner" "$worker" "$judge" "$owner"; do ensure_vault "$v"; done

# 2. Each vault's starting credential.
ensure_credential "$root" claude-code CLAUDE_CODE_OAUTH_TOKEN "Claude Code OAuth token (claude setup-token)"
ensure_credential "$planner" jules JULES_API_KEY "Jules API key"
ensure_credential "$worker" typesafe TYPESAFE_API_KEY "TypeSafe API key for Jules to use"
ensure_credential "$judge" typesafe TYPESAFE_API_KEY "TypeSafe API key for the judge"

# 3. Journals: where the planner preregisters and the judge records.
ensure_journal "$planner" goal plan
ensure_journal "$judge" verdict

# 4. Tokens. The root holds the planner's, so starting the planner is the root's only power over it.
ensure_token "$planner"
if [[ -n "$token" ]]; then
  if item_exists "$root" planner-token; then
    die "$root/planner-token exists but $planner was just created: delete that item and run again"
  fi
  create_item "$root" planner-token hidden "PROTON_PASS_PERSONAL_ACCESS_TOKEN=$token"
  echo "stored: $root/planner-token"
elif ! item_exists "$root" planner-token; then
  die "$planner exists but its token is not in $root/planner-token: delete the $planner token and run again"
fi
ensure_token "$root";  ci_secret JEV_ROOT_PASS_TOKEN "$token"
ensure_token "$judge"; ci_secret JEV_JUDGE_PASS_TOKEN "$token"
token=""

# 5. The chain: editor on its own vault; the judge may read the planner's journal.
grant "$root" editor --vault-name "$root"
grant "$planner" editor --vault-name "$planner"
grant "$judge" editor --vault-name "$judge"
grant "$judge" viewer --vault-name "$planner" --item-title journal

echo
echo "Done. One step is yours: copy $worker/typesafe/TYPESAFE_API_KEY into Jules's"
echo "settings, so Jules can call Jev. Jules cannot use pass-cli, so that hop is outside Pass."
