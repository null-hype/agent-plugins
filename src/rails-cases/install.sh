#!/bin/sh
# Install the experiment command and Pkl contracts.
set -e
rails_cases_home=/usr/local/share/rails-cases
mkdir -p "$rails_cases_home"
cp *.pkl "$rails_cases_home/"
mkdir -p "$rails_cases_home/experiment"
cp experiment/* "$rails_cases_home/experiment/"
install -m 0755 experiment/rails-experiment /usr/local/bin/rails-experiment
# The experiment is independent of the Jev transport and uses Pkl directly.
if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y --no-install-recommends python3 curl ca-certificates
fi
if ! command -v pkl >/dev/null 2>&1; then
    case "$(uname -m)" in
        x86_64) pkl_arch=amd64 ;;
        aarch64|arm64) pkl_arch=aarch64 ;;
        *) echo 'unsupported architecture for Pkl' >&2; exit 1 ;;
    esac
    curl -fsSL "https://github.com/apple/pkl/releases/download/0.32.1/pkl-linux-$pkl_arch" -o /usr/local/bin/pkl
    chmod 0755 /usr/local/bin/pkl
fi
