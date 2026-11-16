-- Demo config: nvim -u editor/init.lua examples/deploy-approval/out/thread.pkl
local here = vim.fs.dirname(debug.getinfo(1, 'S').source:sub(2))
dofile(here .. '/witness.lua')
vim.lsp.config('witness', { filetypes = { 'pkl' } })  -- Witness lists no pkl filetype upstream
vim.filetype.add({ extension = { pkl = 'pkl' } })
vim.diagnostic.config({ virtual_text = true })
