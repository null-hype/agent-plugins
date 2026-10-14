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
npx playwright install --with-deps chromium
