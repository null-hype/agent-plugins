import { test as base, expect } from '@playwright/test';
import { jules } from '@google/jules-sdk';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// The delivery plan: each test is a Question about the product, and each
// `dispatch` asks Jules for the work that should make it true. A session is
// repoless: everything it needs is in its prompt, and what it returns is files.

export type Work = { title: string; prompt: string };
export type GeneratedFile = { path: string; changeType: string; content: string };

/** The Jules key, fetched for one purpose: one Proton Pass access, with that purpose as its reason. */
function key(reason: string) {
  if (process.env.JULES_API_KEY) return process.env.JULES_API_KEY;
  const ref = process.env.JULES_KEY_REF ?? 'pass://infra/jules.google.com/JULES_API_KEY';
  return execFileSync('pass-cli', ['item', 'view', ref], {
    encoding: 'utf8', env: { ...process.env, PROTON_PASS_AGENT_REASON: reason },
  }).trim();
}

export const test = base.extend<{ dispatch: (work: Work) => Promise<GeneratedFile[]> }>({
  dispatch: async ({}, use, testInfo) => {
    await use(async ({ title, prompt }) => test.step(`ask Jules: ${title}`, async () => {
      // The same prompt is the same session: running the plan again finds it
      // instead of starting another. A changed prompt is new work.
      const digest = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
      const sessionTitle = `${title} · ${digest}`;
      const client = jules.with({ apiKey: key(`ask Jules to ${title} (prompt ${digest})`) });

      let found: any;
      let seen = 0;
      for await (const session of client.sessions()) {
        if (session.title === sessionTitle && session.state !== 'failed') { found = session; break; }
        if (++seen >= 200) break;
      }
      if (!found) {
        const created = await client.session({ prompt, title: sessionTitle, requireApproval: false });
        const info = await created.info();
        testInfo.annotations.push({ type: 'jules', description: info.url });
        throw new Error(`asked Jules: ${info.url}. Run again once it completes.`);
      }
      const info = await client.session(found.id).info();
      testInfo.annotations.push({ type: 'jules', description: info.url });
      // Still working is not an answer yet: this fails, and its dependents wait.
      if (info.state !== 'completed') throw new Error(`Jules is ${info.state}: ${info.url}. Run again later.`);
      await testInfo.attach('jules-session', { body: JSON.stringify(info, null, 2), contentType: 'application/json' });
      return (info.generatedFiles ?? []) as GeneratedFile[];
    }));
  },
});

export { expect };
