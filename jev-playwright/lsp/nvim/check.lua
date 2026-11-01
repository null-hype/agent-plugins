-- Headless check of nvim/jev.lua against a real run. From jev-playwright:
--
--   nvim --headless --clean -c "luafile lsp/nvim/jev.lua" \
--     -c "edit tests/questions.spec.ts" -c "luafile lsp/nvim/check.lua"
--
-- Needs a run for the current code (npm test) and leaves the spec as it found
-- it. Set vim.g.jev_run_cmd first to save without Dagger, e.g. node run.mjs.
local function out(s) io.stdout:write(s .. '\n') end
local function messages()
  local diags = vim.diagnostic.get(0)
  table.sort(diags, function(a, b) return a.lnum < b.lnum end)
  local lines = {}
  for _, d in ipairs(diags) do
    lines[#lines + 1] = string.format('line %d  %s  %s', d.lnum + 1, vim.diagnostic.severity[d.severity], d.message)
  end
  return lines
end
local function show(label)
  out('-- ' .. label)
  local lines = messages()
  if #lines == 0 then out('(none)') end
  for _, l in ipairs(lines) do out(l) end
end
local function wait_for(pattern)
  return vim.wait(180000, function()
    for _, l in ipairs(messages()) do if l:match(pattern) then return true end end
    return false
  end, 200)
end
local failed = false
local function expect(ok, what)
  out((ok and 'ok    ' or 'FAIL  ') .. what)
  failed = failed or not ok
end

expect(wait_for('WARN  baseline%-alice%-reads: Mock answer') and not table.concat(messages(), '\n'):match('stale'),
  'a warning on the Alice test, from a run for this code')
show('after opening')

local params = { textDocument = { uri = vim.uri_from_bufnr(0) }, position = { line = 7, character = 5 } }
local found = 0
for _, r in pairs(vim.lsp.buf_request_sync(0, 'textDocument/definition', params, 5000) or {}) do
  found = found + #(r.result or {})
end
expect(found == 6, 'go to definition on line 8 lists six evidence files (' .. found .. ')')

-- Change the code: the run shown becomes stale, then the run the save started lands.
local original = vim.api.nvim_buf_get_lines(0, 0, -1, false)
vim.api.nvim_buf_set_lines(0, -1, -1, false, { '// edited by check.lua' })
vim.cmd('silent write')
expect(wait_for('stale run'), 'after the save, the run shown is marked stale')
show('after the save')
expect(vim.wait(180000, function()
  local lines = messages()
  return #lines > 0 and not table.concat(lines, '\n'):match('stale')
end, 200), 'the run started by the save lands, and is not stale')
show('after the new run')

vim.api.nvim_buf_set_lines(0, 0, -1, false, original)
vim.cmd('silent write')
vim.wait(180000, function() return not table.concat(messages(), '\n'):match('stale') end, 200)
vim.cmd(failed and 'cquit 1' or 'qa!')
