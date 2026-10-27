# jev-lsp

A language server that shows a jev-playwright run on the tests that asked its
Questions.

- A Question answered out of its expected range is a **warning** on the test
  that asked it, naming the Question, the answer and the range.
- A Question whose answer could not be collected is an **error**.
- A Question skipped because a prerequisite failed is **information**.
- An answer in range shows nothing.
- Go to definition (or peek) on a test opens the evidence its answers were
  given on: `state.json`, `request.json` and `response.json`, for every
  revision it asked.

It places each finding with the `location` Playwright reported for the test,
recorded in the run's `comparison.json`. It shows the newest run under the
nearest `runs/` directory that was asked of the code on disk (each run records
its code hash in `inputs.json`; `node inputs.mjs` prints the current one). If
there is none, it shows the newest run and marks each finding `stale run`.
`JEV_RUN_DIR` overrides the choice. It publishes again when a newer run lands,
and does not run anything itself. It runs alongside your TypeScript language
server, not instead of it.

```sh
go build -o jev-lsp .
go test ./...
```

## Neovim

Needs Neovim 0.11 or later. Put `jev-lsp` on your `PATH`, then load
[`nvim/jev.lua`](nvim/jev.lua) from your config:

```lua
dofile('/path/to/jev-playwright/lsp/nvim/jev.lua')
```

It starts the server for TypeScript files under a directory with a
`playwright.config.ts`, and runs the Questions when you save a file in the
harness: `npm run -s dagger` by default, which reuses a run whose inputs have
not changed instead of repeating it. After a save that changes the code, the
findings are marked stale until that run lands. Set before loading:

- `vim.g.jev_lsp_cmd`: the server binary, if not `jev-lsp` on `PATH`
- `vim.g.jev_run_cmd`: what a save runs, e.g. `{ 'node', 'run.mjs' }` without Dagger
- `vim.g.jev_run_on_save = false`: only show runs, never start them

From `jev-playwright`, with a run in place (`npm test` or `npm run dagger`),
open `tests/questions.spec.ts`: the warning is on the Alice test, line 8. On
that line, `:lua vim.lsp.buf.definition()` lists the evidence.

[`nvim/check.lua`](nvim/check.lua) checks all of this headless, and CI runs it
(`.github/workflows/jev-playwright.yml`).
