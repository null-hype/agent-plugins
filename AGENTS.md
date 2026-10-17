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

Review the change against the principles below, and comment as you normally
would. Where a comment applies one of them, name it.

CI already runs the ast-grep rules in `rules/`. You do not need to run them or
repeat their findings.

### A broken instrument fails the run. A refuted hypothesis is a result.

A check that could not run, or whose records contradict each other, must fail.
A check that ran and says the claim is wrong is data: record it, and keep
running what depends on it. Flag code that collapses the two into one failure.

### Write the fact once. Everything else is a projection of it.

A fact has one source, and tests, lessons, fixtures and bindings are derived
from it. Flag a second hand-written copy of something that already has a
source.
