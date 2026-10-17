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

## Product review

In this repository a product gap is a finding, with the same standing as a
bug. This overrides the default rule that only bugs in the code are flagged.
Every review reports product findings as well as code findings; if there are
none, say so in the overall explanation.

Read the commit messages as the change's description, and flag:

- **[P1]** The change does not do what its description says, or does
  something the description does not mention.
- **[P2]** The person it is for will not be able to tell whether it worked:
  it fails silently, or succeeds and fails the same way.
- **[P2]** Something that person needs is missing: a way to find it, turn it
  on, or undo it.
- **[P3]** It is not clear who the change is for or what they can now do.

Start these finding titles with the priority, then `[Product]`, e.g.
`[P2] [Product] ...`. Anchor each at the line it is most about.

## QA pass

Before you write findings, use the change the way the person it is for would,
and report what you saw.

- If the change touches `tutorial-app/` UI or stories, start Storybook
  (`npm run storybook -- --no-open` in `tutorial-app`) and drive the affected
  stories with the `playwright-cli` skill: open them, click through them, and
  take a snapshot or screenshot. Compare what is on screen with what the
  commit messages promise.
- If the change is a script or hook, run it on local inputs (fixtures,
  recorded evidence, a scratch directory). Never run it against real
  services: do not post to GitHub, push, or write to Linear or Proton Pass.
- If you cannot get the feature to run, that is a finding.

Title these findings `[Pn] [QA]`, and put the steps you ran and what you
observed in the body.
