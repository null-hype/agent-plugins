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

## Asking for review

Don't wait for review between PRs. Stack them: base each new PR on the branch
of the one before it, so each diff is one step.

For each PR, open a Linear issue in CIT titled `Review: <PR title>` and link
it from the PR description. Its description is the prompt Richard copies into
Codex, so it must work cold:

- First line: the head branch, the base branch, and the PR URL. Review only
  that diff.
- Then one to three review areas. Each is a question you could not settle
  yourself, the `file:line` it is about, and the AGENTS.md principle it tests,
  or "no principle".
- Nothing else. The diff is the record; don't summarise it.

Codex's answers come back as comments on that issue. Address them as in
"Addressing review comments", then reply in the issue thread so it can be
resolved.
