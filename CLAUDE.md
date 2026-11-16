# CLAUDE.md

## Addressing review comments

Review principles are the `###` headings under "Review guidelines" in
`AGENTS.md`. When you address a review comment that is general rather than a
one-off, also capture it as an ast-grep rule in `rules/`, in the same PR:

- `message` is the heading of the principle it falls under, word for word.
- `rule-tests/<id>-test.yml` takes its `invalid` case from the code the
  comment flagged and its `valid` case from your fix.
- `lint-` rules fail CI; `organ-` rules (`severity: hint`) only inventory.

If no syntax pattern can catch it, say so in your reply instead of writing a
rule. If no principle fits, propose one in your reply; only the maintainer
adds headings to `AGENTS.md`.

## The supervisor

The Render cron `supervisor` is the supervisor: every hour it applies what
merged last time with the Render Workflow's `apply`, its Claude session writes
the next changeset, and the run checks it on the workflow's dev server and
opens its PR with auto-merge on
(`.dagger/internal/devenv-base/supervisor/README.md`). Never disable,
suspend, pause or delete the cron or the Render Workflow without the
maintainer's explicit OK in that conversation, not even to stop a host or
save money. Fix what they run instead.

## Changing a workstation

Anything a dev container needs at build or start (a CLI, a login, a daemon,
resuming Claude) goes in a Feature under `src/` with its test, and in the
`devcontainer.json` that builds the workspace. Never fix a running container
by hand over SSH: the next start loses it. Before writing anything, look for
it in `src/`, in unmerged branches (`git log --all -G <name>`) and in the
toolbox's tools. Credentials come from Pass: a workspace logs in as its own
Pass agent (`pass-cli agent create`, no grants), and the maintainer grants it
items. The `pass-cli` Feature's `color start` logs in Pass and `gh` on every
start.
