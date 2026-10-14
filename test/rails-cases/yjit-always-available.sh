#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
fixtures="$PWD/yjit-always-available"
pkl test -p hash=fddf74bea9 -p case="$fixtures" Recordings.test.pkl yjit-always-available/Confidence.test.pkl
