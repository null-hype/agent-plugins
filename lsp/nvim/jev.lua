-- jev-lsp for Neovim 0.11+.
--
-- Shows a jev-playwright run on the tests that asked its Questions. Load it
-- from your config (dofile) or with :luafile. Set vim.g.jev_lsp_cmd first if
-- the binary is not on PATH as jev-lsp.
vim.lsp.config('jev', {
  cmd = { vim.g.jev_lsp_cmd or 'jev-lsp' },
  filetypes = { 'typescript' },
  root_markers = { 'playwright.config.ts' },
})
vim.lsp.enable('jev')
