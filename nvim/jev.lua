-- Minimal Neovim 0.11+ client for jev-lsp.
--
-- jev-lsp only reads .jev/run/findings.json. If you want TDD-style reruns on
-- save, set vim.g.jev_run_cmd to the command that produces that file.
-- Example: vim.g.jev_run_cmd = { 'npm', 'test' }
vim.lsp.config('jev', {
  cmd = { vim.g.jev_lsp_cmd or 'jev-lsp' },
  filetypes = {
    'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
    'go', 'python', 'rust', 'lua',
  },
  root_markers = { '.jev' },
})
vim.lsp.enable('jev')

local running, queued = {}, {}
local function run(root)
  if not vim.g.jev_run_cmd then return end
  if running[root] then
    queued[root] = true
    return
  end
  running[root] = true
  vim.system(vim.g.jev_run_cmd, { cwd = root, text = true }, function(result)
    running[root] = nil
    if result.code ~= 0 then
      vim.schedule(function()
        vim.notify('jev verifier failed\n' .. (result.stderr or ''), vim.log.levels.WARN)
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
    local root = vim.fs.root(args.buf, { '.jev' })
    if root then run(root) end
  end,
})
