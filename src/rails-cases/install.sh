#!/bin/sh
# CIT-401: replay.sh, its spec and @playwright/test under RAILS_CASES_HOME.
# CIT-404: also the Pkl modules that read a case's fixtures (Frame.pkl imports
# the jev feature's Jev.pkl from /usr/local/share/jev/pkl).
# Needs node; 1.59.1 matches the browsers in mcr.microsoft.com/playwright:v1.59.1.
set -e
rails_cases_home=/usr/local/share/rails-cases
mkdir -p "$rails_cases_home"
cp replay.sh refresh.sh replay.spec.ts playwright.config.ts *.pkl "$rails_cases_home/"
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
chmod +x "$rails_cases_home/replay.sh" "$rails_cases_home/refresh.sh"
cd "$rails_cases_home"
echo '{"private": true}' > package.json
npm install --no-audit --no-fund @playwright/test@1.59.1
# Playwright 1.59.1 has no chromium download build for Ubuntu newer than
# noble, so on a bare ubuntu:latest (now 26.04) builder the install aborts
# with "Playwright does not support chromium on ubuntu26.04-x64". Pin the
# download to the noble build this feature targets (mcr playwright
# v1.59.1-noble). No --with-deps: this step never launches chromium (the
# feature's own test only checks the files land) and the real runtime image
# already ships the browser's OS libraries.
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
