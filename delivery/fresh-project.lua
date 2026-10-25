-- Headless Neovim in the fresh project: is the warning on the moon test?
-- Started by package.spec.ts after the project's questions have run.
local function out(s) io.stdout:write(s .. '\n') end
local want = 'moon: Mock answer 0.95, outside expected [0, 0.2]'
local ok = vim.wait(20000, function()
  for _, d in ipairs(vim.diagnostic.get(0)) do
    if d.lnum == 2 and d.severity == vim.diagnostic.severity.WARN and d.message == want then return true end
  end
  return false
end, 100)
for _, d in ipairs(vim.diagnostic.get(0)) do
  out(string.format('line %d  %s  %s', d.lnum + 1, vim.diagnostic.severity[d.severity], d.message))
end
out((ok and 'ok    ' or 'FAIL  ') .. 'line 3 warns: ' .. want)
vim.cmd(ok and 'qa!' or 'cquit 1')
