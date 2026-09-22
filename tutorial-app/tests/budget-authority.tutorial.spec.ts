import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { buildAcpTraceState, deriveTraceView, type AcpTraceFixture } from '../src/lib/acpTraceProtocol';
import { buildBudgetAuthorityLessons, QUESTION, serializeFixture } from '../src/lib/budgetAuthorityStoryboard';
import { mergeProposalBranches } from './budget-authority/merge';
import { LESSON_META, PROSE } from './budget-authority/prose';

// CIT-251: the CIT-250 story as one continuous `@tutorial` storyboard. Each
// top-level step is one turn and compiles to one lesson (reporters/README.md).
// The browser here is the real acp-trace client page (server.cjs, started by
// playwright.budget-authority.config.ts), fed the same payload
// AcpTraceBridge sends it inside TutorialKit. Every assertion reads the
// rendered page -- labels, regions, colour -- never the prose, so the
// argument has to be legible with the lesson text hidden.

const TRACE = 'acp-trace.json';

async function attachTutorial(testInfo: TestInfo, index: number, name: string, body: string, contentType: string) {
  await testInfo.attach(`tutorial:${index}:${name}`, { body, contentType });
}

let revision = 0;
async function show(page: Page, fixture: AcpTraceFixture) {
  revision += 1;
  const payload = buildAcpTraceState({ revision, fixture });
  await page.evaluate((payload) => window.postMessage({ type: 'lesson-state', source: 'tk-acp-trace-bridge', payload }, '*'), payload);
}

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const entries = (page: Page, name: string) => region(page, name).locator('.entry');
const pin = (page: Page, id: string) => page.locator(`[data-pin="${id}"]`);
const log = async (page: Page) => (await page.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' ');

async function expectLogLine(page: Page, needle: string) {
  await expect.poll(() => log(page)).toContain(needle);
}

/** Only the Budget channel may use pass/fail colour; the others share one neutral style. */
async function expectOnlyBudgetIsColoured(page: Page) {
  const colours = await page.locator('#trace-view .entry').evaluateAll((nodes) =>
    nodes.map((node) => ({ channel: (node as HTMLElement).dataset.channel, colour: getComputedStyle(node).color })),
  );
  const neutral = new Set(colours.filter((c) => c.channel !== 'budget').map((c) => c.colour));
  expect(neutral.size).toBeLessThanOrEqual(1);
  for (const { channel, colour } of colours.filter((c) => c.channel === 'budget')) {
    expect(neutral.has(colour), `budget entry colour ${colour} matches a non-budget channel`).toBe(false);
    expect(channel).toBe('budget');
  }
}

test('Proposal P against the budget', { tag: '@tutorial' }, async ({ page }, testInfo) => {
  const merge = mergeProposalBranches();
  const lessons = buildBudgetAuthorityLessons(merge);
  const shortTree = merge.tree.slice(0, 12);
  const pinSnapshots = new Map<string, string>();

  await page.goto('/');
  await page.locator('.monaco-editor .view-lines').waitFor();

  // Shared per-turn bookkeeping: attach the lesson's start (and the incoming
  // turn that got it there), show it, run the turn's own assertions for the
  // pending state, then the same for the recorded reply.
  async function turn(
    index: number,
    pending: (page: Page) => Promise<void>,
    replied: (page: Page) => Promise<void>,
  ) {
    const lesson = lessons[index - 1];
    const start = serializeFixture(lesson.start);
    if (index > 1) await attachTutorial(testInfo, index, `incoming/file/${TRACE}`, start, 'application/json');
    await attachTutorial(testInfo, index, `before/file/${TRACE}`, start, 'application/json');
    await show(page, lesson.start);
    await pending(page);

    await show(page, lesson.end);
    await replied(page);
    await expectOnlyBudgetIsColoured(page);
    // For reviewing the rendered turn by eye; not a tutorial attachment.
    if (process.env.STORYBOARD_SCREENSHOTS) await page.screenshot({ path: testInfo.outputPath(`turn-${index}.png`) });

    // Pinned objects never change once pinned: same bytes in every later turn.
    for (const view of deriveTraceView(lesson.end.frames).pins) {
      const bytes = JSON.stringify({ id: view.id, label: view.label, text: view.text, simulated: view.simulated });
      expect(pinSnapshots.get(view.id) ?? bytes, `pin ${view.id} changed after it was pinned`).toBe(bytes);
      pinSnapshots.set(view.id, bytes);
      await expect(pin(page, view.id).locator('.text')).toHaveText(view.text);
    }

    await attachTutorial(testInfo, index, `file/${TRACE}`, serializeFixture(lesson.end), 'application/json');
    await attachTutorial(testInfo, index, 'prose', PROSE[index - 1], 'text/markdown');
    await attachTutorial(testInfo, index, 'meta', JSON.stringify(LESSON_META), 'application/json');
  }

  await test.step(lessons[0].title, async () => {
    await turn(
      1,
      async (page) => {
        await expect(page.getByText('Scripted replay (CIT-251 storyboard) · not a live capture')).toBeVisible();
        await expect(pin(page, 'question')).toContainText(QUESTION);
        await expect(pin(page, 'limit-v1')).toContainText('budget ≤ 1200');
        await expect(entries(page, 'Type')).toHaveText([/^malformed · worker reason/]);
        for (const name of ['Merge', 'Budget', 'Authority']) await expect(region(page, name)).toContainText('not evaluated');
        await expectLogLine(page, 'jev (agent): type the answer  ->  awaiting recorded turn (Solve replays it)');
      },
      async (page) => {
        // The whole response is labelled simulated -- the answer and its confidence together.
        await expect(pin(page, 'jev-answer')).toContainText('YES · 0.94');
        await expect(pin(page, 'jev-answer').locator('.tag.simulated')).toHaveText('simulated · stub, not a recorded Jev answer');
        // Type shows its current state; malformed has been replaced, not appended to.
        await expect(entries(page, 'Type')).toHaveText([/^well-formed · \{answer: YES, confidence: 0\.94\} \(simulated\)$/]);
        await expect(entries(page, 'Type').last()).toHaveAttribute('data-status', 'well-formed');
        // Well-formed is not approval: Budget is untouched.
        await expect(region(page, 'Budget')).toContainText('not evaluated');
        await expect.poll(() => log(page)).not.toContain('awaiting recorded turn');
      },
    );
  });

  await test.step(lessons[1].title, async () => {
    await turn(
      2,
      async (page) => {
        await expect(pin(page, 'branch-airfare')).toContainText('airfare 890');
        await expect(pin(page, 'branch-ground')).toContainText('ground 400');
        await expect(pin(page, 'proposal-P')).toHaveCount(0);
        await expectLogLine(page, 'git (agent): merge  ->  awaiting recorded turn (Solve replays it)');
      },
      async (page) => {
        await expect(pin(page, 'proposal-P')).toContainText(`airfare 890 + ground 400 · tree ${shortTree}`);
        await expect(entries(page, 'Merge')).toHaveText(['clean · 0 conflicts']);
        // A clean merge is not a budget pass.
        await expect(region(page, 'Budget')).toContainText('not evaluated');
        await expect(pin(page, 'jev-answer')).toContainText('YES · 0.94');
      },
    );
  });

  await test.step(lessons[2].title, async () => {
    await turn(
      3,
      async (page) => {
        await expectLogLine(page, 'client: send prompt  ->  sent  session/prompt "Run the budget check on proposal P."');
        await expectLogLine(page, 'checks (agent): evaluate  ->  awaiting recorded turn (Solve replays it)');
      },
      async (page) => {
        const fail = entries(page, 'Budget').first();
        await expect(fail).toHaveAttribute('data-status', 'fail');
        await expect(fail).toHaveAttribute('data-rule', 'limit-v1');
        await expect(fail).toContainText('FAIL @ v1: 890 + 400 = 1290 > 1200');
        await expect(fail.locator('.tag.rule')).toHaveText('evaluated against Limit rule v1');
        // The confident answer and the clean merge remain beside the failure.
        await expect(pin(page, 'jev-answer')).toContainText('YES · 0.94');
        await expect(entries(page, 'Merge')).toHaveText(['clean · 0 conflicts']);

        // The diagnostic's supporting evidence is actually readable, via the
        // same CodeLens -> evidence widget interaction the ghost-trace lessons use.
        await page.locator('.codelens-decoration a', { hasText: 'budget-exceeds-limit' }).click();
        const evidence = page.getByRole('region', { name: 'Diagnostic evidence' });
        await expect(evidence).toBeVisible();
        await expect(evidence).toContainText(`proposal/P@tree ${shortTree}`);
        await expect(evidence).toContainText('rules/limit@v1');
        await expect(evidence).toContainText('budget ≤ 1200');
        await expect(evidence).toContainText('jev/answer');
        await expect(evidence).toContainText('contradicted: 1290 > 1200');
      },
    );
  });

  await test.step(lessons[3].title, async () => {
    await turn(
      4,
      async (page) => {
        await expectLogLine(page, 'worker (agent): request permission  ->  sent  session/request_permission "Raise limit rule v1 1200 → 1300 for proposal P"');
        await expectLogLine(page, 'supervisor (client): grant 1200 → 1300  ->  awaiting recorded turn (Solve replays it)');
        await expect(region(page, 'Authority')).toContainText('not evaluated');
      },
      async (page) => {
        const record = entries(page, 'Authority').first();
        await expect(record).toContainText(`granted by supervisor: v1 1200 → v2 1300 · scope Proposal P (tree ${shortTree}, unchanged)`);
        // The limitation sits beside the decision itself, not only in prose.
        await expect(record.locator('.caption')).toHaveText('Recorded supervisor decision · enforcement simulated');
        // Scope has a consequence: v2 applies to P, and v1 is superseded for P only.
        await expect(pin(page, 'limit-v2')).toContainText(`budget ≤ 1300 · applies to Proposal P (tree ${shortTree}) only`);
        await expect(pin(page, 'limit-v1').locator('.tag.superseded')).toHaveText('superseded for Proposal P by Limit rule v2 (supervisor)');
        // The earlier FAIL is not re-judged; it is marked as having read the superseded rule.
        const fail = entries(page, 'Budget').first();
        await expect(fail).toContainText('FAIL @ v1');
        await expect(fail.locator('.tag.superseded')).toHaveText('superseded for Proposal P by Limit rule v2 (supervisor)');
        await expect(entries(page, 'Budget')).toHaveCount(1);
      },
    );
  });

  await test.step(lessons[4].title, async () => {
    await turn(
      5,
      async (page) => {
        await expectLogLine(page, 'checks (agent): queue re-evaluation  ->  sent  session/update "Re-run the budget check on P @ v2"');
        await expectLogLine(page, 'checks (agent): re-evaluate  ->  awaiting recorded turn (Solve replays it)');
      },
      async (page) => {
        const [fail, pass] = [entries(page, 'Budget').nth(0), entries(page, 'Budget').nth(1)];
        await expect(pass).toHaveAttribute('data-status', 'pass');
        await expect(pass).toHaveAttribute('data-rule', 'limit-v2');
        await expect(pass).toContainText('PASS @ v2: 890 + 400 = 1290 ≤ 1300 (granted by supervisor)');
        // The earlier FAIL stays, still tied to v1, and v1 itself still reads as it did in turn 1.
        await expect(fail).toHaveAttribute('data-status', 'fail');
        await expect(fail).toHaveAttribute('data-rule', 'limit-v1');
        await expect(fail).toContainText('FAIL @ v1: 890 + 400 = 1290 > 1200');
        await expect(fail.locator('.tag.rule')).toHaveText('evaluated against Limit rule v1');
        await expect(pin(page, 'limit-v1').locator('.text')).toHaveText('budget ≤ 1200');
        // Everything the argument rests on is still on screen.
        await expect(pin(page, 'question')).toContainText(QUESTION);
        await expect(pin(page, 'jev-answer')).toContainText('YES · 0.94');
        await expect(pin(page, 'proposal-P')).toContainText(`tree ${shortTree}`);
        await expect(entries(page, 'Type').last()).toHaveAttribute('data-status', 'well-formed');
        await expect(entries(page, 'Merge')).toHaveText(['clean · 0 conflicts']);
        await expect(entries(page, 'Authority').first().locator('.caption')).toHaveText('Recorded supervisor decision · enforcement simulated');
        await expectLogLine(page, 'checks (agent): re-evaluate  ->  budget-within-limit');
        // v2 was granted for P and only P is evaluated under it: nothing is out of scope.
        await expect(page.locator('.tag.out-of-scope')).toHaveCount(0);
      },
    );
  });
});
