import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The noise in Jev's answer to the registered question, for Delivery.pkl's
// `noise`: asks it CAPTURE_RUNS times (default 4) of each fixed state, a run's
// priorities.json, and records each step's answers and their max-min spread
// in noise-observed.json. It makes paid calls and reads the judge's key: run
// it on purpose, before registering the noise.
//
//   node delivery/capture.mjs <plan run>/priorities.json <work run>/priorities.json
const here = path.dirname(fileURLToPath(import.meta.url));
// Only what is asked: the noise is not registered yet.
const question = execFileSync('pkl', ['eval', '-x', 'question', path.join(here, 'Delivery.pkl')], { encoding: 'utf8' }).trim();
const key = execFileSync('pass-cli', ['item', 'view', process.env.TYPESAFE_KEY_REF ?? 'pass://jev-judge/typesafe/TYPESAFE_API_KEY'], {
  encoding: 'utf8', env: { ...process.env, PROTON_PASS_AGENT_REASON: 'measure the noise in Jev\'s is_priority answer for Delivery.pkl' },
}).trim();
const client = new TypeSafeClient({ apiKey: key });
const runs = Number(process.env.CAPTURE_RUNS ?? 4);

const states = {};
const models = new Set();
for (const file of process.argv.slice(2)) {
  const { level, state, ranked } = JSON.parse(readFileSync(file, 'utf8'));
  const work = ranked.map((r) => r.work);
  const answers = Object.fromEntries(work.map((w) => [w, []]));
  for (let i = 0; i < runs; i++) {
    const { answers: a, model } = await client.systemOne({
      state,
      questions: Object.fromEntries(work.map((w, j) => [`is_priority_${j}`, noul(`${question} ${w}`)])),
    });
    models.add(model);
    work.forEach((w, j) => answers[w].push(a[`is_priority_${j}`].noul));
  }
  states[level] = Object.fromEntries(Object.entries(answers).map(([w, xs]) => [w, { answers: xs, spread: +(Math.max(...xs) - Math.min(...xs)).toFixed(4) }]));
}
const spread = Math.max(...Object.values(states).flatMap((s) => Object.values(s).map((x) => x.spread)));
const out = path.join(here, 'noise-observed.json');
writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), models: [...models], runs, question, spread, states }, null, 2) + '\n');
console.log(`wrote ${out}: widest spread ${spread} over ${runs} runs on ${[...models].join(', ')}`);
