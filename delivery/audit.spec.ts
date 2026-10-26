import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, ownerMonitor } from './fixtures';
import { noul } from './jev';

// The owner's audit of a finished run. Only the owner's Pass session sees every
// agent's accesses, so this runs there, never in CI:
//
//   DELIVERY_RUN=<the run's downloaded test-results> npx playwright test -c delivery --project audit
//
// Each agent is a step and each reason it gave Pass is a step inside it, so the
// report is the run's reasons, agent by agent. Jev asks of each reason whether it
// is still urgent, given what the run produced: the hypothesis is that work that
// landed scores low, and a finished run scores low throughout.

const here = path.dirname(fileURLToPath(import.meta.url));
const goal = readFileSync(path.join(here, 'goal.md'), 'utf8').trim();
const agents = ['jev-root', 'jev-planner', 'jev-judge'];
type Record = { action: string; action_time: string; payload: { reason?: string; vault_name?: string; item_name?: string } };

test('Is anything this run asked for still urgent?', async ({}, testInfo) => {
  const run = process.env.DELIVERY_RUN;
  test.skip(!run, 'set DELIVERY_RUN to the downloaded test-results of a run');
  const read = (f: string) => readFileSync(path.join(run!, f), 'utf8');
  const started = Date.parse(JSON.parse(read('started.json')).at) - 60_000;
  const ledger: { role: string; reason: string }[] = read('reasons.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // Jules's plans are steps in the report; plans.json is there only after the plan project.
  const evidence = { plans: existsSync(path.join(run!, 'plans.json')) ? JSON.parse(read('plans.json')) : undefined, report: JSON.parse(read('report.json')).suites };
  const key = process.env.AUDIT_KEY_REF ?? 'pass://infra/typesafe.ai/TYPESAFE_API_KEY';
  const jev = await import('./fixtures').then((f) => f.ownerSecret(key, `audit the delivery run: is anything still urgent toward ${goal}`));

  const seen = new Set<string>();
  for (const agent of agents) {
    await test.step(agent, async () => {
      const records = (JSON.parse(ownerMonitor(agent) || '[]') as Record[]).filter((r) => Date.parse(r.action_time) >= started);
      await testInfo.attach(`${agent}.json`, { body: JSON.stringify(records, null, 2), contentType: 'application/json' });
      for (const r of records) {
        const reason = r.payload.reason ?? '(no reason)';
        seen.add(reason);
        await test.step(reason, async () => {
          const p = await noul(jev, { goal, agent, reason, access: r, evidence }, 'The evidence does not yet show done what this reason asked for');
          testInfo.annotations.push({ type: 'is-urgent', description: `${p}  ${agent}: ${reason}` });
        });
      }
    });
  }

  await test.step('every reason the run gave is in the log', async () => {
    expect(ledger.filter((l) => !seen.has(l.reason)).map((l) => `${l.role}: ${l.reason}`), 'given but not recorded').toEqual([]);
  });
});
