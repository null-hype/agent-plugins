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

Two rules organize everything below. Flag a change that breaks either one.

### A broken instrument fails the run. A refuted hypothesis is a result.

A check that says no should return its report as a result. Only a check that
could not run should error out. Keep the two apart in types, for example with an
outcome that separates `Refuted` from `Broken`.

- **Fail loudly, let a human resolve.** An agent should be able to cause a
  failure that a human then resolves, for example by granting vault access.
  Flag changes that stop the agent from acting instead of letting the check
  fail.
- **Test the result, not the machinery.** Flag tests of machinery rather than
  results: checking that another feature works as advertised, renaming or
  counting files, or checking the experiment scaffolding. Assert on what a user
  of the feature would see, such as a claim falling within a confidence range.

### Write the fact once. Everything else is a projection of it.

Generate what can be derived, for example Pkl bindings and test projects built
from a data source. Flag hand-written copies of a fact that lives elsewhere.

- **Layering.** Features install tools and fixtures, scenarios exercise them,
  and Dagger explores on top. Flag code that does one layer's job in another,
  such as a hand-rolled runner or a Dagger function copying in files a Feature
  should install.
- **Conventional paths.** Config loads from conventional locations, Rails
  style. Flag hardcoded absolute paths, needless relative paths, and paths
  passed around through env vars or arguments when a convention would find
  them.
- **No waffle.** Flag README or docs prose that describes intentions with no
  command, test or evidence link behind it. A doc should be driven by a test.
