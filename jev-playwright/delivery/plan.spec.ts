import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const goal = readFileSync(path.join(here, 'goal.md'), 'utf8').trim();

// Our plan, written before Jules is asked. Jules's plan is judged against the
// goal, and against these.
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

test('Does Jules plan the work that achieves the goal?', async ({ planFor, judge }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const plan = await test.step('ask Jules for a plan', () => planFor(goal, prompt));
  await testInfo.attach('jules-plan.json', { body: JSON.stringify(plan, null, 2), contentType: 'application/json' });
  const ask = judge(`ask Jev whether Jules's plan serves the goal: ${goal}`);

  // Each answer is data: a low one is a finding about the plan, not a failure.
  for (const step of plan.steps) {
    await test.step(`Jev: does "${step.title}" serve the goal?`, async () => {
      const p = await ask({ goal, step }, 'Does this step of the plan serve the goal? Judge only the supplied goal and step.');
      testInfo.annotations.push({ type: 'serves-goal', description: `${p}  ${step.title}` });
    });
  }
  for (const step of ours) {
    await test.step(`Jev: does Jules's plan cover "${step}"?`, async () => {
      const p = await ask({ plan: plan.steps.map((s) => s.title), step }, 'Does the plan cover this step? Judge only the supplied plan and step.');
      testInfo.annotations.push({ type: 'covers-ours', description: `${p}  ${step}` });
    });
  }
});
