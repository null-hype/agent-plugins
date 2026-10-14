#!/usr/bin/env bash
# Run under pass-cli with test/_global/rails-cases/.env.
set -euo pipefail
[ "$#" -eq 2 ] || { echo "usage: $0 <case> <snapshot-id>" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
exec "$here/../../src/rails-cases/refresh.sh" "$1" "$2" "$here/$1"
