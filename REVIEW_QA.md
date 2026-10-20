Review against origin/main

Local QA used stubs only; no GitHub or backup service was called by the scripts.
- Snapshot listing failure: simulated restic exit 17 became successful empty sync (CIT-444).
- Repeated review in one session: second verdict skipped with exit 0 (CIT-445).
- Push review: recorded findings set failure and script exit 0; Codex exit 23 after a verdict set error and script exit 1.
- check-organs: 6 rules checked against 2 principles. Ast-grep was not run, per repository instructions.
- codexReviewModel: all 3 Vitest tests passed.
- Storybook launched with npm run storybook -- --no-open. Used index.json to discover Investigations/A Codex review, opened its Findings on the reviewed lines story with project-local playwright-cli and Chromium. Observed the reviewed commit and verdict in the path, finding lenses and warnings; clicked Monaco and pressed F8 to show the second finding's full explanation. Captured snapshot and screenshot (tutorial-app/codex-review-qa.png in helping-locust). No additional UI findings.

QA environment: helping-locust. Its configuration adds Node 24, jq, Python and Pkl; persist that setup with `cu config import helping-locust` if needed. Initial missing runtimes and a Vite overlay cache rename error were resolved before the completed browser check.
