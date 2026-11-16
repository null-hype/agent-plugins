if not vim.wait(10000, function() return #vim.diagnostic.get(0) > 0 end, 100) then
  io.stderr:write('FAIL: no diagnostics\n'); vim.cmd('cquit 1')
end
vim.wait(1000)
for _, d in ipairs(vim.diagnostic.get(0)) do
  io.stdout:write(string.format('line %d sev %d: %s\n', d.lnum + 1, d.severity, d.message))
end
vim.cmd('qa!')
