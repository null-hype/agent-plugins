import { readFileSync } from 'node:fs';
import { test } from './fixtures';

// A node of our plan: install witness, the language server, and its editor
// setup with one dev container feature. Jules is asked only the task, plans it,
// and once its plan is approved carries it out; Jev judges each file it writes.
test('Can one dev container feature install witness and its Neovim setup?', async ({ plan, approve }) => {
  test.setTimeout(60 * 60_000);
  const { task } = test.info().config.metadata.delivery;
  const steps = await plan(task);
  // planOnly stops at the plan, unapproved: the run before Jules's work, after
  // which the planner registers what the work should do to each step.
  if (test.info().project.metadata.planOnly) return;
  // DELIVERY_FAILED is how the world rejected Jules's work: Jules repairs it.
  const failed = process.env.DELIVERY_FAILED && readFileSync(process.env.DELIVERY_FAILED, 'utf8');
  await approve(task, steps, { failed: failed || undefined });
});
