// Builds worlds/run7 and worlds/first-passing from worlds/Scenarios.pkl, the one
// place their scores and times are written (Reconcile.test.pkl imports it too):
// run from delivery/ with pkl on PATH, `node worlds/mk.mjs`.
import { execFileSync } from 'node:child_process';
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
const scenarios = JSON.parse(execFileSync('pkl', ['eval', '-f', 'json', 'worlds/Scenarios.pkl'], { encoding: 'utf8' }));
for (const [name, dir] of [['run7', 'worlds/run7'], ['firstPassing', 'worlds/first-passing']]) {
  const s = scenarios[name];
  const shown = (key) => Object.fromEntries(s.steps.map((st) => [st.title, st[key]]));
  world(dir, {
    registered: { item: 'jev-planner/journal', role: 'Viewer', written: s.written, plan: s.steps.map(({ title, after }) => ({ title, after })) },
    plan: { created: [s.planCreated], approved: [], shown: shown('plan') },
    work: { created: [s.workCreated], approved: [s.approved], shown: shown('work') },
  });
}
