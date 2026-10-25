-- jev-lsp for Neovim 0.11+.
--
-- Shows a jev-playwright run on the tests that asked its Questions, and runs
-- the Questions again when a file in the harness is saved. Load it from your
-- config (dofile) or with :luafile.
--
--   vim.g.jev_lsp_cmd      the server binary (default: jev-lsp on PATH)
--   vim.g.jev_run_cmd      what a save runs (default: npm run -s dagger, which
--                          reuses an unchanged run instead of repeating it)
--   vim.g.jev_run_on_save  false to only show runs, never start them
vim.lsp.config('jev', {
  cmd = { vim.g.jev_lsp_cmd or 'jev-lsp' },
  filetypes = { 'typescript' },
  root_markers = { 'playwright.config.ts' },
})
vim.lsp.enable('jev')

-- One run per harness at a time; a save during a run queues one more, so the
-- last run always reflects the last save. The server publishes each run as it
-- lands, and marks the one shown stale while the files are ahead of it.
local running, queued = {}, {}
local function run(root)
  if running[root] then
    queued[root] = true
    return
  end
  running[root] = true
  vim.system(vim.g.jev_run_cmd or { 'npm', 'run', '-s', 'dagger' }, { cwd = root, text = true }, function(result)
    running[root] = nil
    -- A run that ends FAIL still landed; only a run that never started is reported.
    if not (result.stdout or ''):match('artifacts:') then
      vim.schedule(function()
        vim.notify('jev: the run did not start\n' .. (result.stderr or ''), vim.log.levels.WARN)
      end)
    end
    if queued[root] then
      queued[root] = nil
      vim.schedule(function() run(root) end)
    end
  end)
end

vim.api.nvim_create_autocmd('BufWritePost', {
  group = vim.api.nvim_create_augroup('jev', { clear = true }),
  callback = function(args)
    if vim.g.jev_run_on_save == false then return end
    local root = vim.fs.root(args.buf, { 'inputs.mjs' })
    if root then run(root) end
  end,
})
