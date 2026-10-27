import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// What witness showed on the spec, gathered as data for Reconcile.pkl to
// judge: for each run, when it began, the model Jev answered on, each step's
// priority as shown, and any answer off its test's line or stale.
//
//   node delivery/facts.mjs <spec> <out.json> plan=<diagnostics.json>,<run dir> work=...
const [spec, out, ...runs] = process.argv.slice(2);
const lines = readFileSync(spec, 'utf8').split('\n');
const facts = {};
for (const arg of runs) {
  const [level, files] = arg.split('=');
  const [diagnostics, run] = files.split(',');
  const shown = {}, offLine = [], stale = [];
  for (const d of JSON.parse(readFileSync(diagnostics, 'utf8'))) {
    if (d.message.startsWith('stale')) stale.push(d.message);
    const m = /^(\d\.\d\d) still a priority: (.*)$/.exec(d.message);
    if (!m) continue;
    shown[m[2]] = Number(m[1]);
    if (!/^\s*test\(/.test(lines[d.range.start.line] ?? '')) offLine.push(`line ${d.range.start.line + 1}: ${m[2]}`);
  }
  const { began, model } = JSON.parse(readFileSync(path.join(run, 'priorities.json'), 'utf8'));
  facts[level] = { began, model, shown, offLine, stale };
}
writeFileSync(out, JSON.stringify(facts, null, 2) + '\n');
