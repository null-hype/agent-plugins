import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, planFile } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const goal = readFileSync(path.join(here, 'goal.md'), 'utf8').trim();

// Our plan, written before Jules is asked. The judge compares Jules's plan with
// the goal, and with these.
const ours = [
  'Answer a Noul question with Jev from TypeScript, with no Python',
  'Run the mechanical steps in Dagger from a Playwright fixture',
  'Package the fixtures so any Playwright project can install them',
  'Install the language server and its editor setup with one dev container feature',
];

const prompt = `${goal}

What exists: jev-playwright, a Playwright harness. Each test asks a Question; the Jev
API (TypeSafe) answers it with a probability; a Pkl contract holds each Question's
expected range; reconcile writes each answer, with the line of the test that asked it,
to comparison.json. jev-lsp, a Go language server, shows those answers as diagnostics
on the test lines. The Jev client is Python, and the harness is not yet installable.

Plan the work that achieves the goal.`;

// The planner's part: ask Jules for a plan, and leave it beside ours for the
// judge. Judging it is retro's, under the judge's own key.
test('Does Jules plan the work that achieves the goal?', async ({ planFor }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const plan = await test.step('ask Jules for a plan', () => planFor(goal, prompt));
  writeFileSync(planFile(), JSON.stringify({ goal, ours, jules: plan }, null, 2) + '\n');
  await testInfo.attach('plans.json', { path: planFile(), contentType: 'application/json' });
});
