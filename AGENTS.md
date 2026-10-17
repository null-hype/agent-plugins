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

Review rules live in `rules/` as ast-grep rules, with tests in `rule-tests/`
(`sgconfig.yml`). Each rule's `message` is an organ: a one-sentence principle
that several rules can share. Its `note` says what this particular footprint
looks like. The organs so far:

- "A broken instrument fails the run. A refuted hypothesis is a result."
- "Write the fact once. Everything else is a projection of it."

When reviewing:

1. Run `npx --yes --package=@ast-grep/cli@0.50.0 ast-grep scan --no-ignore hidden`
   and report every `lint-*` hit in the changed files as a finding, quoting the
   rule's `message`. `organ-*` rules are an inventory (severity `hint`). Report
   one of them only when the diff adds code that goes against its organ.
2. Judge the diff against each organ's `message`, even where no rule matches.

## Turning review comments into rules

A human review comment that states something general becomes a rule, not
prose in this file.

1. Distill the comment to one sentence. Reuse an existing organ's `message`
   when it fits. Propose a new organ only when none does.
2. Find the syntax that shows the problem and write `rules/<id>.yml` with that
   sentence as `message` and the footprint as `note`. Use the `organ-` prefix
   and `severity: hint` for an inventory, or the `lint-` prefix with `warning`
   or `error` for a check that `hk check` enforces.
3. Add `rule-tests/<id>-test.yml`, taking `invalid` cases from the code the
   comment was about and `valid` cases from code that respects the organ. Run
   `ast-grep test --update-all` to write the snapshot, then `ast-grep test`.
4. Cite the review comment the rule came from in the PR or reply that adds it.
   If the problem has no syntax footprint, say so instead of writing a rule
   that only matches by name.
