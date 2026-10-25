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
recorded in the run's `comparison.json`. It reads `JEV_RUN_DIR`, or the newest
run under the nearest `runs/` directory above the open file, and publishes
again when a newer run lands. It does not run anything itself. It runs
alongside your TypeScript language server, not instead of it.

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

Or set `vim.g.jev_lsp_cmd = '/path/to/jev-lsp'` before loading it. It starts for
TypeScript files under a directory with a `playwright.config.ts`.

Then, from `jev-playwright`:

```sh
npm test                           # a mock run: one warning, on line 8
nvim tests/questions.spec.ts
```

The warning is on the Alice test. On that line, `:lua vim.lsp.buf.definition()`
lists the evidence. Run
`npm run score -- --mock-answers fixtures/prerequisite-fails.json` in another
terminal: within a couple of seconds line 8 shows an error, and an information
note for the patched question it skipped.
