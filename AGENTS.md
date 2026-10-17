# AGENTS.md

This repository is a research prototype for agent capability governance. It
hosts devcontainer Features (`src/<feature>`, tested under `test/`), Dagger
modules (`.dagger/`, `bountybench-dagger-*/`), Pkl contracts and goldens
(`capability-spike/`, `src/*/pkl`, `*.test.pkl`), and a TutorialKit/Astro +
Storybook site (`tutorial-app/`, published as www.tidelands.dev).

Repo skills live in `.agents/skills/`:

- `playwright-cli`: drive a browser and work with Playwright tests, using the
  project-local CLI at `tutorial-app/node_modules/.bin/playwright-cli`.
- `storybook-mcp`: inspect and test stories through the Storybook MCP server
  (`npm run storybook -- --no-open` in `tutorial-app`, registered in
  `.codex/config.toml`) or `storybook tools` when the server is not running.

## Review guidelines
