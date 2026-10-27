import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, planFile } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const goal = readFileSync(path.join(here, 'goal.md'), 'utf8').trim();

// Our plan, written before Jules is asked. The judge compares Jules's plan with
// the goal, and with these.
const ours = [
  'Answer a Noul question with Jev from TypeScript, with no Python',
  'Run the mechanical steps in Dagger from a Playwright fixture',
  'Package the fixtures so any Playwright project can install them',
  'Install the language server and its editor setup with one dev container feature',
];

// The code as it is: the subject of the plan, frozen in subject/ (the harness
// this experiment came from). The session is repoless, so its sandbox starts
// empty: what Jules is to change has to be in the prompt.
const files = [
  'README.md', 'package.json', 'playwright.config.ts', 'global-setup.ts', 'ask.ts', 'collectors.ts',
  'reporter.ts', 'reconcile.mjs', 'consistency.mjs', 'score.mjs', 'pkl.mjs', 'inputs.mjs',
  'pkl/Experiment.pkl', 'pkl/Reconcile.pkl', 'tests/questions.spec.ts', 'delivery/jev.ts',
  'lsp/go.mod', 'lsp/main.go', 'lsp/findings.go', 'lsp/README.md', 'lsp/nvim/jev.lua',
];

const prompt = `${goal}

Below is jev-playwright, the code as it is, one file per section. Change it, and add to
it, so the goal holds. Keep the paths: your files will be applied at jev-playwright/.

${files.map((f) => `=== ${f}\n${readFileSync(path.join(f.startsWith('delivery/') ? root : path.join(here, 'subject'), f), 'utf8')}`).join('\n')}`;

// The planner's part: give Jules the task and keep the plan it makes before any
// work (approval is required, so it waits there) for the judge, beside ours.
test('Does Jules plan the work that achieves the goal?', async ({ planFor }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const plan = await test.step('ask Jules for a plan', () => planFor(goal, prompt));
  writeFileSync(planFile(), JSON.stringify({ goal, ours, jules: plan }, null, 2) + '\n');
  await testInfo.attach('plans.json', { path: planFile(), contentType: 'application/json' });
});
