#!/bin/bash
# CIT-401: the control's story, replayed with no Storybook and no Jev: every
# response comes from replay.har. Record it with
#   pass-cli run --env-file .env -- dagger call securerandom-always-two-har export --path test/rails-cases/securerandom-always-two
# The scenario's folder is the generated .devcontainer.
set -e
har=.devcontainer/replay.har
[ -f "$har" ] || { echo "no $har: record it (see above)" >&2; exit 1; }
"$RAILS_CASES_HOME/replay.sh" "$har" securerandom-always-two always 'always 2'
