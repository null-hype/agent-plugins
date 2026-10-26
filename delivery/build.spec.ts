import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, planFile, patchFile, type Plan } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const goal = readFileSync(path.join(here, 'goal.md'), 'utf8').trim();

// The planner again, once the plan is judged: Jules carries out the plan it
// made, and its patch, applied at jev-playwright/, is the run's result.
test('Does Jules carry out its plan?', async ({ build }, testInfo) => {
  test.setTimeout(45 * 60_000);
  const plan = (JSON.parse(readFileSync(planFile(), 'utf8')) as { jules: Plan }).jules;
  const { patch, files } = await test.step('approve the plan and wait for Jules', () => build(goal, plan));
  testInfo.annotations.push({ type: 'patch', description: files.join('\n') || '(no files)' });
  writeFileSync(patchFile(), patch);
  await testInfo.attach('jules.patch', { path: patchFile(), contentType: 'text/x-diff' });
  test.expect(patch, 'Jules finished without a patch').not.toBe('');
});
