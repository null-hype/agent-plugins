#!/bin/bash

# CIT-271 free-agent detector, hint level 0. One scenario per hint level =>
# one fresh, repo-less container per level (see cit-271-free-agent/run-detector.sh
# for the full rationale and the isolation guarantees). This script only pins
# the level, then sources the shared helper from the mounted test workspace
# (devcontainer features test copies all of test/_global into the container's
# workspace; $0 runs from that workspace root, so its sibling dir is here).
#
#    devcontainer features test --global-scenarios-only .
export CIT271_HINT_LEVEL=0
source "$(dirname "$0")/cit-271-free-agent/run-detector.sh"
