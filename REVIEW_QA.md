Review against origin/main

Linear: CIT-432
PR: https://github.com/null-hype/agent-plugins/pull/215

The three codexReviewModel Vitest tests passed. Started Storybook with npm run storybook -- --no-open; discovered the story through index.json; opened Findings on the reviewed lines using the project-local playwright-cli, clicked the Monaco editor, pressed F8, and captured a snapshot and screenshot. Observed the recorded verdict, warning ranges, and the second finding's full explanation in the problem widget. No additional UI or product findings.
