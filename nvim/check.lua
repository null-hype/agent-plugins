local function fail(message)
  io.stderr:write('FAIL: ' .. message .. '\n')
  vim.cmd('cquit 1')
end

if not vim.wait(10000, function() return #vim.diagnostic.get(0) == 1 end, 100) then
  fail('expected one diagnostic')
end
local d = vim.diagnostic.get(0)[1]
if d.lnum ~= 1 or d.message ~= "Alice can read Bob's private document" then
  fail('unexpected diagnostic: ' .. vim.inspect(d))
end

local params = {
  textDocument = { uri = vim.uri_from_bufnr(0) },
  position = { line = 1, character = 3 },
}
local found = 0
for _, response in pairs(vim.lsp.buf_request_sync(0, 'textDocument/definition', params, 5000) or {}) do
  found = found + #(response.result or {})
end
if found ~= 2 then fail('expected two evidence locations, got ' .. found) end

io.stdout:write('ok: diagnostic and evidence navigation came from .jev/run/findings.json\n')
vim.cmd('qa!')
