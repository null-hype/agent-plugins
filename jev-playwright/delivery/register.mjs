import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The planner registers what the work should do to each step of Jules's
// approved plan, before the run, in its journal: jev-planner/journal, field
// `plan`. Predicted.pkl checks the shape first, so a registration that would
// not type is never written.
//
//   node delivery/register.mjs <predictions.json>   # [{ "title": ..., "after": "cools" | "steady" }, ...]
const here = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const check = path.join(mkdtempSync(path.join(tmpdir(), 'register-')), 'registered.json');
writeFileSync(check, JSON.stringify({ item: 'jev-planner/journal', role: 'Viewer', written: new Date().toISOString(), plan }));
execFileSync('pkl', ['eval', '-p', `registered=file://${check}`, path.join(here, 'Predicted.pkl')], { stdio: ['ignore', 'ignore', 'inherit'] });
const dir = process.env.PASS_SESSION_PLANNER;
execFileSync('pass-cli', ['item', 'update', '--vault-name', 'jev-planner', '--item-title', 'journal', '--field', `plan=${JSON.stringify(plan)}`], {
  stdio: 'inherit',
  env: { ...process.env, PROTON_PASS_AGENT_REASON: 'register what the work should do to each step of the plan, before the run', ...(dir && { PROTON_PASS_SESSION_DIR: dir, PROTON_PASS_KEY_PROVIDER: 'fs' }) },
});
console.log(`registered ${plan.length} steps in jev-planner/journal`);
