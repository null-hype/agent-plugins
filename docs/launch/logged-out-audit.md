# Logged-out journey audit (CIT-166)

> **Status: IN PROGRESS.** Check date: 2026-10-03. There is no blanket claim that every route, viewport, inbox, or interactive turn is verified.

## Scope of the new browser check

[`launch.smoke.spec.ts`](../../tutorial-app/tests/launch.smoke.spec.ts) runs in fresh logged-out desktop and Pixel 7 Chromium contexts. It:

1. Navigates the site root and waits for the landing redirect.
2. Finds the explanation, private email link, and public issue link.
3. Clicks into the canonical demo and verifies its visible scope disclosure.
4. Follows the evidence link into the public GitHub document.
5. Opens the public contact route, verifies GitHub sign-in, and checks that the issue-form destination is preserved.
6. Checks canonical/social metadata and requests the actual preview image and favicon on the tested deployment.

The smoke check verifies discovery/navigation plumbing. It does not run Solve/Reset through all WebContainer lessons, submit an issue, send email, verify mailbox ownership/delivery, test LinkedIn discovery, or establish a response SLA. Existing budget playback tests cover a separate interactive scenario.

## Public observations

Read-only HTTP checks returned 200 for the site root, landing page, public claims document, and Storybook URL. The site root uses an in-page redirect, so the 200 alone does not prove browser navigation. The public issue URL redirects logged-out visitors to GitHub sign-in with the full intended issue-form URL in `return_to`.

The branch adds `mailto:public.rant@pm.me`. It is absent from the currently deployed landing page on both tested viewports. Finding the link after publication still will not verify receipt or the owner's reply workflow. GitHub requires an account to create an issue; the audit does not describe this route as anonymous issue submission.

The currently deployed metadata still lacks the new preview image and favicon. LinkedIn publication and mailbox delivery remain unverified.

## Commands and CI

```bash
cd tutorial-app
npm ci
npx playwright install chromium
# Real public site, desktop and mobile:
npx playwright test --config=playwright.launch.config.ts
# Branch build (different evidence):
npm run build
LAUNCH_BASE_URL=http://127.0.0.1:4321 npx playwright test --config=playwright.launch.config.ts
```

`.github/workflows/tutorial-launch.yml` runs the relevant Vitest suite, build, and branch browser smoke check for PRs. Its manually dispatched public-smoke job runs against production after publication, with reports/traces retained as artifacts. An optional `PLAYWRIGHT_PROXY_SERVER` supports environments requiring an outbound proxy.

## Verification record

- Vitest: 17 files passed, 173 tests passed, two existing tests skipped.
- Astro: production build completed (26 pages).
- Branch browser smoke: four checks passed, covering desktop and mobile. The QA browser used the execution environment's outbound proxy and trusted its supplied proxy CA; the committed CI configuration retains default HTTPS validation.
- Public browser smoke: all four checks failed. Both journey checks stopped because the landing page has no private email route; both metadata checks stopped because `og:url` is missing. Subsequent checks for new image/card/favicon assets remain undeployed. These are live launch gaps, not a public PASS.
- Real public metadata: incomplete pending deployment.
- Mailbox receipt / owner reply workflow: not tested.
- LinkedIn profile discovery: not verified.

Keep CIT-166 open until the actual public route and remaining acceptance criteria are verified.
