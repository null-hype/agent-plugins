-- Minimal Neovim 0.11+ client for witness.
--
-- witness only reads .witness/run/findings.json. If you want TDD-style reruns on
-- save, set vim.g.witness_run_cmd to the command that produces that file.
-- Example: vim.g.witness_run_cmd = { 'npm', 'test' }
vim.lsp.config('witness', {
  cmd = { vim.g.witness_lsp_cmd or 'witness' },
  filetypes = {
    'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
    'go', 'python', 'rust', 'lua',
  },
  root_markers = { '.witness' },
})
vim.lsp.enable('witness')

local running, queued = {}, {}
local function run(root)
  if not vim.g.witness_run_cmd then return end
  if running[root] then
    queued[root] = true
    return
  end
  running[root] = true
  vim.system(vim.g.witness_run_cmd, { cwd = root, text = true }, function(result)
    running[root] = nil
    if result.code ~= 0 then
      vim.schedule(function()
        vim.notify('witness verifier failed\n' .. (result.stderr or ''), vim.log.levels.WARN)
      end)
    end
    if queued[root] then
      queued[root] = nil
      vim.schedule(function() run(root) end)
    end
  end)
end

vim.api.nvim_create_autocmd('BufWritePost', {
  group = vim.api.nvim_create_augroup('witness', { clear = true }),
  callback = function(args)
    local root = vim.fs.root(args.buf, { '.witness' })
    if root then run(root) end
  end,
})
