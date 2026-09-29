#!/bin/bash

# CIT-271 free-agent detector, hint level 0. One scenario per hint level =>
# one fresh, repo-less container per level (see cit-271-free-agent/run-detector.sh
# for the full rationale and the isolation guarantees). All logic lives in the
# image-baked helper; this script only pins the level for this scenario.
#
#    devcontainer features test --global-scenarios-only .
export CIT271_HINT_LEVEL=0
source /opt/cit-271/run-detector.sh
