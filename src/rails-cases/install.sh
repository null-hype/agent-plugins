#!/bin/sh
# CIT-401: replay.sh, its spec and @playwright/test under RAILS_CASES_HOME.
# CIT-404: also the Pkl modules that read a case's fixtures (Frame.pkl imports
# the jev feature's Jev.pkl from /usr/local/share/jev/pkl).
# Needs node; 1.59.1 matches the browsers in mcr.microsoft.com/playwright:v1.59.1.
set -e
home=/usr/local/share/rails-cases
mkdir -p "$home"
cp replay.sh refresh.sh replay.spec.ts playwright.config.ts *.pkl "$home/"
chmod +x "$home/replay.sh" "$home/refresh.sh"
cd "$home"
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
