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
