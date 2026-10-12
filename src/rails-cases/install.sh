#!/bin/sh
# CIT-401: replay.sh, its spec and @playwright/test under RAILS_CASES_HOME.
# Needs node; 1.59.1 matches the browsers in mcr.microsoft.com/playwright:v1.59.1.
set -e
home=/usr/local/share/rails-cases
mkdir -p "$home"
cp replay.sh replay.spec.ts playwright.config.ts "$home/"
chmod +x "$home/replay.sh"
cd "$home"
echo '{"private": true}' > package.json
npm install --no-audit --no-fund @playwright/test@1.59.1
npx playwright install --with-deps chromium
