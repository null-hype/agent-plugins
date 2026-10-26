import { test as base, expect } from '@playwright/test';
import { jules, type SessionClient } from '@google/jules-sdk';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
export type Plan = { id: string; url: string; steps: PlanStep[] };

/** Where the build project leaves Jules's patch. */
export const patchFile = () => path.join(path.dirname(process.env.DELIVERY_LEDGER!), 'jules.patch');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Fixtures = {
  /** Jules's plan for a goal: a repoless session that waits for approval of its plan. */
  planFor: (goal: string, prompt: string) => Promise<Plan>;
  /** Jules's work on an approved plan: approves it, waits for the session to
   * complete, and returns its patch. */
  build: (goal: string, plan: Plan) => Promise<{ patch: string; files: string[] }>;
  /** The judge asks Jev one Noul question; the key is fetched once per test, for `purpose`. */
  judge: (purpose: string) => (state: unknown, instructions: string) => Promise<number>;
  /** One hunk: one file, written by one small repoless Jules session from `ask`,
   * then judged by Jev against `ask`. Returns the file's content. */
  hunk: (file: string, ask: string) => Promise<string>;
};

/** Jules's last word to us, when it stops to ask: the test fails with it. */
async function blocked(session: SessionClient, url: string, annotations: { type: string; description?: string }[]) {
  let asked = '(no message)';
  for await (const a of session.history()) if (a.type === 'agentMessaged') asked = a.message;
  annotations.push({ type: 'jules asks', description: asked });
  return new Error(`Jules is waiting for an answer: ${url}\n\n${asked}`);
}

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
      // Approval is required, so Jules waits with its plan until the build approves it.
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
      let steps = await plan();
      for (const until = Date.now() + 8 * 60_000; !steps && Date.now() < until; ) {
        const { state } = await session.info();
        if (state === 'awaitingUserFeedback') throw await blocked(session, url, testInfo.annotations);
        if (state === 'failed') throw new Error(`Jules failed: ${url}`);
        if (state === 'awaitingPlanApproval') steps = await plan();
        if (!steps) await sleep(15_000);
      }
      if (!steps) throw new Error(`Jules has no plan yet: ${url}. Run again later.`);
      return { id, url, steps: steps.map((s: any) => ({ title: s.title, description: s.description })) };
    });
  },
  build: async ({}, use, testInfo) => {
    await use(async (goal, plan) => {
      const client = jules.with({ apiKey: secret('planner', JULES_KEY, `have Jules carry out its plan: ${goal}`) });
      const session = client.session(plan.id);
      testInfo.annotations.push({ type: 'jules', description: plan.url });
      // Running again picks up where the session is: approved once, then waited on.
      for (const until = Date.now() + 40 * 60_000; Date.now() < until; ) {
        const { state } = await session.info();
        if (state === 'awaitingPlanApproval') await session.approve();
        else if (state === 'awaitingUserFeedback') throw await blocked(session, plan.url, testInfo.annotations);
        else if (state === 'failed') throw new Error(`Jules failed: ${plan.url}`);
        else if (state === 'completed') {
          const outcome = await session.result();
          return {
            patch: outcome.changeSet()?.gitPatch.unidiffPatch ?? '',
            files: outcome.generatedFiles().all().map((f) => `${f.changeType} ${f.path}`),
          };
        }
        await sleep(30_000);
      }
      throw new Error(`Jules has not finished yet: ${plan.url}. Run again later.`);
    });
  },
  hunk: async ({ judge }, use, testInfo) => {
    const client = jules.with({ apiKey: secret('planner', JULES_KEY, `have Jules write one file of ${testInfo.title}`) });
    const verdict = judge(`ask Jev whether Jules's file does what was asked: ${testInfo.title}`);
    await use(async (file, ask) => {
      const prompt = `${ask.trim()}\n\nWrite it as the one file ${file}.`;
      const title = `hunk · ${file} · ${createHash('sha256').update(prompt).digest('hex').slice(0, 12)}`;
      // The same ask is the same session: running again collects it instead of asking again.
      let id: string | undefined;
      let seen = 0;
      for await (const s of client.sessions()) {
        if (s.title === title && s.state !== 'failed') { id = s.id; break; }
        if (++seen >= 200) break;
      }
      if (!id) id = (await client.run({ prompt, title })).id;
      const session = client.session(id);
      const url = (await session.info()).url;
      testInfo.annotations.push({ type: 'jules', description: `${file}  ${url}` });

      for (const until = Date.now() + 20 * 60_000; Date.now() < until; ) {
        const { state } = await session.info();
        if (state === 'awaitingUserFeedback') throw await blocked(session, url, testInfo.annotations);
        if (state === 'failed') throw new Error(`Jules failed: ${url}`);
        if (state === 'completed') {
          const files = (await session.result()).generatedFiles().all().filter((f) => f.changeType !== 'deleted');
          const written = files.find((f) => f.path.endsWith(file)) ?? (files.length === 1 ? files[0] : undefined);
          if (!written) throw new Error(`Jules wrote no ${file}: ${url} (${files.map((f) => f.path).join(', ') || 'no files'})`);
          const out = path.join(testInfo.outputDir, file);
          mkdirSync(path.dirname(out), { recursive: true });
          writeFileSync(out, written.content);
          await testInfo.attach(file, { path: out, contentType: 'text/plain' });
          const p = await verdict({ ask, file: written.content }, 'Does the file do what was asked? Judge only the supplied ask and file.');
          testInfo.annotations.push({ type: 'does-what-was-asked', description: `${p}  ${file}` });
          return written.content;
        }
        await sleep(20_000);
      }
      throw new Error(`Jules has not written ${file} yet: ${url}. Run again later.`);
    });
  },
  judge: async ({}, use) => {
    let key: string | undefined;
    await use((purpose) => async (state, instructions) => noul(key ??= secret('judge', JEV_KEY, purpose), state, instructions));
  },
});

export { expect };
