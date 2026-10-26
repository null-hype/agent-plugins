import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, planFile } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const goal = readFileSync(path.join(here, 'goal.md'), 'utf8').trim();

// The judge's part, under the judge's own key: Jules's plan against the goal and
// against ours. Each answer is data: a low one is a finding, not a failure.
test("Does Jules's plan serve the goal, and cover ours?", async ({ judge }, testInfo) => {
  const ask = judge(`ask Jev whether Jules's plan serves the goal: ${goal}`);
  const plans = JSON.parse(readFileSync(planFile(), 'utf8')) as { ours: string[]; jules: { steps: { title: string; description?: string }[] } };
  for (const step of plans.jules.steps) {
    await test.step(`Jev: does "${step.title}" serve the goal?`, async () => {
      const p = await ask({ goal, step }, 'Does this step of the plan serve the goal? Judge only the supplied goal and step.');
      testInfo.annotations.push({ type: 'serves-goal', description: `${p}  ${step.title}` });
    });
  }
  for (const step of plans.ours) {
    await test.step(`Jev: does Jules's plan cover "${step}"?`, async () => {
      const p = await ask({ plan: plans.jules.steps.map((s) => s.title), step }, 'Does the plan cover this step? Judge only the supplied plan and step.');
      testInfo.annotations.push({ type: 'covers-ours', description: `${p}  ${step}` });
    });
  }
});
