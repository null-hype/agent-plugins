#!/bin/bash
# CIT-404: the global run for case securerandom-always-two (rails dbafc460fa); see rails-cases/ask-jev.sh.
export RAILS_CASE=securerandom-always-two RAILS_CASE_HASH=dbafc460fa
source "$(dirname "$0")/rails-cases/ask-jev.sh"
