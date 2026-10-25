import { test } from 'jev-lsp';

test('Is the moon made of cheese?', async ({ ask }) => {
  await ask({ observation: 'Grey regolith, basalt and dust. No dairy.' });
});
