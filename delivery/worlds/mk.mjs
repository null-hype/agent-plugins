// Builds worlds/run7 and worlds/first-passing from the scores the check printed
// (the same numbers as Reconcile.test.pkl): run from delivery/, `node worlds/mk.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';
const w = (f, v) => writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n');
function world(dir, { registered, plan, work }) {
  mkdirSync(`${dir}/plan-run`, { recursive: true });
  mkdirSync(`${dir}/work-run`, { recursive: true });
  const titles = registered.plan.map((s) => s.title);
  w(`${dir}/spec.txt`, titles.map((t) => `test(${JSON.stringify(t)}, async () => {});\n`).join(''));
  w(`${dir}/registered.json`, registered);
  for (const [name, run] of [['plan', plan], ['work', work]]) {
    w(`${dir}/${name}.json`, titles.map((t, i) => ({ message: `${run.shown[t].toFixed(2)} still a priority: ${t}`, range: { start: { line: i, character: 0 }, end: { line: i, character: 4 } } })));
    w(`${dir}/${name}-run/priorities.json`, { julesSessionsCreated: run.created, julesPlansApproved: run.approved, model: 'jev-1.14.0' });
  }
}
const reg = (written, steps) => ({ item: 'jev-planner/journal', role: 'Viewer', written, plan: steps.map(([title, after]) => ({ title, after })) });
world('worlds/run7', {
  registered: reg('2026-10-27T07:52:52.000Z', [['Create `src/witness/devcontainer-feature.json`.', 'cools'], ['Create `src/witness/install.sh`.', 'cools'], ['Complete pre commit steps.', 'steady'], ['Submit the change.', 'steady']]),
  plan: { created: ['2026-10-27T07:47:34.000Z'], approved: [], shown: { 'Create `src/witness/devcontainer-feature.json`.': 0.37, 'Create `src/witness/install.sh`.': 0.44, 'Complete pre commit steps.': 0.45, 'Submit the change.': 0.45 } },
  work: { created: ['2026-10-27T08:00:00.000Z'], approved: ['2026-10-27T07:53:00.000Z'], shown: { 'Create `src/witness/devcontainer-feature.json`.': 0.39, 'Create `src/witness/install.sh`.': 0.35, 'Complete pre commit steps.': 0.51, 'Submit the change.': 0.53 } },
});
world('worlds/first-passing', {
  registered: reg('2026-10-27T10:10:00.000Z', [['Create the dev container feature definition', 'cools'], ['Create the installation script', 'cools'], ['Complete pre-commit steps', 'steady'], ['Submit the change', 'steady']]),
  plan: { created: ['2026-10-27T10:01:00.000Z'], approved: [], shown: { 'Create the dev container feature definition': 0.59, 'Create the installation script': 0.58, 'Complete pre-commit steps': 0.52, 'Submit the change': 0.52 } },
  work: { created: ['2026-10-27T10:30:00.000Z'], approved: ['2026-10-27T10:20:00.000Z'], shown: { 'Create the dev container feature definition': 0.33, 'Create the installation script': 0.27, 'Complete pre-commit steps': 0.49, 'Submit the change': 0.48 } },
});
