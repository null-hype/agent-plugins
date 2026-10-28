import { readFileSync } from 'node:fs';

// Whether the planner has registered for the plan Jules just presented: after
// Jules was asked for it, for exactly its steps. Until then the work waits,
// and this prints the steps for the planner to register against.
//
//   node delivery/ready.mjs <registered.json> <plan run's priorities.json>
const [registered, priorities] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const steps = priorities.state.tests.flatMap((t) => t.plan ?? []);
if (!steps.length) throw new Error('the plan run shows no plan');
const asked = (priorities.julesSessionsCreated ?? []).map((t) => new Date(t).toISOString());
if (!asked.length) throw new Error('the plan run asked Jules nothing');
const titles = registered.plan.map((s) => s.title);
const same = titles.length === steps.length && steps.every((s) => titles.includes(s));
const after = asked.every((t) => t < registered.written);
if (same && after) {
  console.log(`the predictions, last changed ${registered.written}, are for this plan`);
} else {
  console.error(`The planner has not registered for this plan yet${after ? '' : ` (the predictions were last changed ${registered.written}, before Jules was asked at ${asked.join(', ')})`}.
Register what the work should do to each step, then check again:

  node delivery/register.mjs predictions.json

${JSON.stringify(steps.map((title) => ({ title, after: 'cools | steady' })), null, 2)}`);
  process.exit(1);
}
