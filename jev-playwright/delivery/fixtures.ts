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

/** The owner's own Pass access, for the audit: no agent session. */
export function ownerSecret(ref: string, reason: string) {
  return execFileSync('pass-cli', ['item', 'view', ref], {
    encoding: 'utf8', env: { ...process.env, PROTON_PASS_AGENT_REASON: reason },
  }).trim();
}

/** One agent's accesses, as JSON, from the owner's session: an agent's own
 * session sees only its own. */
export function ownerMonitor(agent: string) {
  const run = spawnSync('pass-cli', ['agent', 'monitor', agent, '--output', 'json'], { encoding: 'utf8', timeout: 30_000 });
  if (run.status !== 0 && !run.stdout) throw new Error(run.stderr || run.error?.message || `agent monitor ${agent} failed`);
  return run.stdout;
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

      // A session just made has no activities yet: Jules answers 404 until it does.
      const plan = async () => {
        try {
          for await (const a of session.history()) if (a.type === 'planGenerated') return a.plan.steps;
        } catch (e: any) {
          if (!String(e?.message).includes('404')) throw e;
        }
      };
      // Jules's last word to us, when it stops to ask instead of planning.
      const question = async () => {
        let last: string | undefined;
        for await (const a of session.history()) if (a.type === 'agentMessaged') last = a.message;
        return last;
      };
      let steps = await plan();
      for (const until = Date.now() + 8 * 60_000; !steps && Date.now() < until; ) {
        const { state } = await session.info();
        if (state === 'awaitingUserFeedback') {
          const asked = await question();
          testInfo.annotations.push({ type: 'jules asks', description: asked ?? '(no message)' });
          throw new Error(`Jules is waiting for an answer: ${url}\n\n${asked ?? '(no message)'}`);
        }
        if (state === 'failed') throw new Error(`Jules failed: ${url}`);
        if (state === 'awaitingPlanApproval') steps = await plan();
        if (!steps) await new Promise((r) => setTimeout(r, 15_000));
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
