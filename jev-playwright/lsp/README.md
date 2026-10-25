# jev-lsp

A language server that shows a jev-playwright run as diagnostics on the
`.pcf` that declared its questions.

- A question Jev answered out of its expected range is a **warning** on its
  `["id"]` key, with the score and the range.
- A question whose answer could not be collected is an **error**.
- A question skipped because a prerequisite failed is **information**.
- An answer in range shows nothing.
- Go to definition (or peek) on a question opens the evidence Jev judged:
  `state.json`, `request.json`, `response.json`.

It reads the newest run under `runs/` next to the `.pcf`, or the run in
`JEV_RUN_DIR`. It runs alongside `pkl-lsp`, not instead of it.

```sh
go build -o jev-lsp .
go test ./...
```

Neovim:

```lua
vim.filetype.add({ extension = { pcf = 'pkl' } })
vim.lsp.start({ name = 'jev-lsp', cmd = { '/path/to/jev-lsp' },
  root_dir = vim.fn.getcwd() })
```
