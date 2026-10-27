import { test } from './fixtures';

// A node of our plan: install the language server and its editor setup with one
// dev container feature. Jules is asked only the task, plans it, and once its
// plan is approved carries it out; Jev judges each file it writes.
test('Can one dev container feature install jev-lsp and its Neovim setup?', async ({ plan, approve }) => {
  test.setTimeout(60 * 60_000);
  const task = 'Write a dev container feature that installs jev-lsp and its Neovim setup';
  // planOnly approves the plan and stops there: the run before Jules's work.
  await approve(task, await plan(task), { wait: !test.info().project.metadata.planOnly });
});
