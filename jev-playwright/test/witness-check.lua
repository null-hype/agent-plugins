-- Headless check of this harness's witness run, with the witness Neovim client.
-- From jev-playwright, after a run (npx playwright test) and with witness on PATH:
--
--   nvim --headless --clean \
--     -c "lua vim.g.witness_run_cmd = { 'npx', 'playwright', 'test' }" \
--     -c "luafile <witness>/nvim/witness.lua" \
--     -c "edit tests/questions.spec.ts" -c "luafile test/witness-check.lua"
--
-- Leaves the spec as it found it.
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
local function shown(pattern) return table.concat(messages(), '\n'):match(pattern) ~= nil end
local function wait_for(f) return vim.wait(180000, f, 200) end
local failed = false
local function expect(ok, what)
  out((ok and 'ok    ' or 'FAIL  ') .. what)
  failed = failed or not ok
end

expect(wait_for(function() return shown('line 8  WARN  baseline%-alice%-reads: canned answer') end) and not shown('stale'),
  'a warning on the Alice test, from a run of this code')
show('after opening')

local params = { textDocument = { uri = vim.uri_from_bufnr(0) }, position = { line = 7, character = 5 } }
local found = 0
for _, r in pairs(vim.lsp.buf_request_sync(0, 'textDocument/definition', params, 5000) or {}) do
  found = found + #(r.result or {})
end
expect(found == 3, 'go to definition on line 8 lists the state, request and response (' .. found .. ')')

-- Change the code: the finding shown becomes stale, then the run the save started lands.
local original = vim.api.nvim_buf_get_lines(0, 0, -1, false)
vim.api.nvim_buf_set_lines(0, -1, -1, false, { '// edited by witness-check.lua' })
vim.cmd('silent write')
expect(wait_for(function() return shown('stale') end), 'after the save, the finding shown is marked stale')
show('after the save')
expect(wait_for(function() return #messages() > 0 and not shown('stale') end),
  'the run started by the save lands, and is not stale')
show('after the new run')

vim.api.nvim_buf_set_lines(0, 0, -1, false, original)
vim.cmd('silent write')
wait_for(function() return #messages() > 0 and not shown('stale') end)
vim.cmd(failed and 'cquit 1' or 'qa!')
