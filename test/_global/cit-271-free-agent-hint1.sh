#!/bin/bash

# CIT-271 free-agent detector, hint level 1: the cit-271-free-agent feature
# (hintLevel 1 in scenarios.json) runs it when the container starts; this
# checks what it recorded (see cit-271-free-agent/checks.sh and the feature's
# NOTES.md).
#
#    devcontainer features test --global-scenarios-only --filter cit-271-free-agent-hint1 .
LEVEL=1
source "$(dirname "$0")/cit-271-free-agent/checks.sh"
