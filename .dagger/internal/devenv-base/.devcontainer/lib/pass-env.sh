# Sourced by the start scripts. pass_env FILE prints the path of a copy of
# the env file FILE whose pass://vault/item/field references the current
# pass-cli session can resolve.
#
# A session that can see a reference's vault resolves it by name, and it is
# kept. A Pass agent granted single items (linear-agent-host,
# toolbox/setup-agent-pass.sh) sees no vaults: it sees each item as an item
# share, which pass-cli resolves only as pass://<share id>/<item id>/field.
# A share id changes with every grant, so ids are looked up here on each
# start, from the item's title, and never written down. The copy holds
# references only, never values.
pass_env() {
  local src=$1 out vaults shares line name ref vault item field share id n
  out=$(mktemp "${TMPDIR:-/tmp}/pass-env.XXXXXX")
  chmod 600 "$out"
  vaults=$(pass-cli vault list --output json | jq -r '.vaults[]?.name')
  shares=""
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      [A-Za-z_]*=pass://*) ;;
      *) printf '%s\n' "$line" >> "$out"; continue ;;
    esac
    name=${line%%=*} ref=${line#*=pass://}
    IFS=/ read -r vault item field <<< "$ref"
    if grep -qxF "$vault" <<< "$vaults"; then
      printf '%s\n' "$line" >> "$out"
      continue
    fi
    [ -n "$shares" ] || shares=$(pass-cli share list --output json)
    share=$(jq -r --arg t "$item" '.shares[] | select(.share_type == "Item" and .name == $t) | .id' <<< "$shares")
    n=$(grep -c . <<< "$share" || true)
    if [ "$n" != 1 ]; then
      echo "pass_env: $src: $name: this Pass session cannot see vault $vault, and sees $n item shares named $item, not one" >&2
      rm -f "$out"
      return 1
    fi
    id=$(pass-cli item list --share-id "$share" --output json | jq -r --arg t "$item" '[.. | objects | select(.share_id? and (.title // .content.title) == $t) | .id] | .[0] // empty')
    if [ -z "$id" ]; then
      echo "pass_env: $src: $name: item share $item lists no item $item" >&2
      rm -f "$out"
      return 1
    fi
    printf '%s=pass://%s/%s/%s\n' "$name" "$share" "$id" "$field" >> "$out"
  done < "$src"
  echo "$out"
}
