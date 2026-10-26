import { test as base, expect } from '@playwright/test';
import { jules } from '@google/jules-sdk';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { noul } from './jev';

export type Role = 'planner' | 'judge';

/** The Pass session of an agent: PASS_SESSION_PLANNER or PASS_SESSION_JUDGE, as
 * CI logs each one in with its own token (bootstrap.sh). Unset, it is yours. */
function session(role: Role) {
  const dir = process.env[`PASS_SESSION_${role.toUpperCase()}`];
  return dir ? { ...process.env, PROTON_PASS_SESSION_DIR: dir, PROTON_PASS_KEY_PROVIDER: 'fs' } : { ...process.env };
}

/** A secret, fetched by one agent for one purpose: one Proton Pass access, with
 * that purpose as its reason. The ledger is the run's own list of the reasons it
 * gave, for retro to find in the Pass monitor log. pass-cli has no SDK, so this
 * file is the only place it runs. */
export function secret(role: Role, ref: string, reason: string) {
  appendFileSync(process.env.DELIVERY_LEDGER!, JSON.stringify({ role, reason, at: new Date().toISOString() }) + '\n');
  return execFileSync('pass-cli', ['item', 'view', ref], {
    encoding: 'utf8', env: { ...session(role), PROTON_PASS_AGENT_REASON: reason },
  }).trim();
}

/** The Pass monitor log as one agent sees it. monitor may stream: what it
 * printed in 30s is the log. */
export function passMonitor(role: Role) {
  const run = spawnSync('pass-cli', ['agent', 'monitor', '--output', 'json'], { encoding: 'utf8', timeout: 30_000, env: session(role) });
  return { log: run.stdout ?? '', error: run.stderr || run.error?.message || '' };
}

/** Where the plan project leaves Jules's plan, and ours, for the judge. */
export const planFile = () => path.join(path.dirname(process.env.DELIVERY_LEDGER!), 'plans.json');

const JULES_KEY = process.env.JULES_KEY_REF ?? 'pass://jev-planner/jules/JULES_API_KEY';
const JEV_KEY = process.env.TYPESAFE_KEY_REF ?? 'pass://jev-judge/typesafe/TYPESAFE_API_KEY';

export type PlanStep = { title: string; description?: string };

type Fixtures = {
  /** Jules's plan for a goal: a repoless session that stops at its plan. */
  planFor: (goal: string, prompt: string) => Promise<{ url: string; steps: PlanStep[] }>;
  /** The judge asks Jev one Noul question; the key is fetched once per test, for `purpose`. */
  judge: (purpose: string) => (state: unknown, instructions: string) => Promise<number>;
};

export const test = base.extend<Fixtures>({
  planFor: async ({}, use, testInfo) => {
    await use(async (goal, prompt) => {
      // The same prompt is the same session: running again reads its plan
      // instead of asking for another.
      const digest = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
      const title = `plan · ${digest}`;
      const client = jules.with({ apiKey: secret('planner', JULES_KEY, `ask Jules to plan: ${goal}`) });

      let id: string | undefined;
      let seen = 0;
      for await (const s of client.sessions()) {
        if (s.title === title && s.state !== 'failed') { id = s.id; break; }
        if (++seen >= 200) break;
      }
      // Approval is required, so Jules stops once it has a plan and writes nothing.
      if (!id) id = (await client.session({ prompt, title, requireApproval: true })).id;
      const session = client.session(id);
      const url = (await session.info()).url;
      testInfo.annotations.push({ type: 'jules', description: url });

      const plan = async () => {
        for await (const a of session.history()) if (a.type === 'planGenerated') return a.plan.steps;
      };
      let steps = await plan();
      if (!steps) {
        await Promise.race([session.waitFor('awaitingPlanApproval'), new Promise((r) => setTimeout(r, 8 * 60_000))]);
        steps = await plan();
      }
      if (!steps) throw new Error(`Jules has no plan yet: ${url}. Run again later.`);
      return { url, steps: steps.map((s: any) => ({ title: s.title, description: s.description })) };
    });
  },
  judge: async ({}, use) => {
    let key: string | undefined;
    await use((purpose) => async (state, instructions) => noul(key ??= secret('judge', JEV_KEY, purpose), state, instructions));
  },
});

export { expect };
