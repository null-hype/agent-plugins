import { expect, test, type FrameLocator, type Page } from '@playwright/test';

// CIT-251: plays the lessons the storyboard compiled into
// src/content/tutorial/part-3, inside the real TutorialKit app with its
// WebContainer-hosted previews, using only TutorialKit's own controls:
// Solve and Reset in the editor chrome, Next in the lesson navigation. The
// storyboard already asserts every turn's rendering in detail; this checks
// the compiled lessons play back as that same continuous thread.

const CHAPTER = '/part-3/proposal-p-against-the-budget';
const BOOT = { timeout: 180_000 };

const client = (page: Page) => page.frameLocator('iframe[title="Client"]');
const log = (frame: FrameLocator) => frame.locator('.monaco-editor .view-lines');
const region = (frame: FrameLocator, name: string) => frame.getByRole('region', { name, exact: true });
const pin = (frame: FrameLocator, id: string) => frame.locator(`[data-pin="${id}"]`);

async function expectPending(page: Page, line: string) {
  await expect(log(client(page))).toContainText(`${line}  ->  awaiting recorded turn (Solve replays it)`, BOOT);
}

async function solve(page: Page) {
  // The only Solve on the page is TutorialKit's own; the lesson markdown embeds none.
  await expect(page.getByRole('button', { name: /^Solve:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await expect(log(client(page))).not.toContainText('awaiting recorded turn');
  await expectVerdictsInView(page);
}

/**
 * All four verdict channels must be on screen in the real preview pane, not
 * reachable only by scrolling: with the prose hidden, they carry the argument.
 */
async function expectVerdictsInView(page: Page) {
  for (const name of ['Type', 'Merge', 'Budget', 'Authority']) {
    await expect(region(client(page), name)).toBeInViewport({ ratio: 1 });
  }
}

async function next(page: Page, slug: string) {
  await page.locator(`a[href="${CHAPTER}/${slug}"]`).first().click();
  await page.waitForURL(`**${CHAPTER}/${slug}`);
}

test('the compiled budget-authority lessons play back as one thread', async ({ page }) => {
  await page.goto(`${CHAPTER}/1-jev-types-the-answer`);

  await test.step('lesson 1: Solve replays Jev, Reset returns to the incoming turn', async () => {
    await expectPending(page, 'jev (agent): type the answer');
    await expect(region(client(page), 'Type').locator('.entry')).toHaveText([/^malformed/]);
    await solve(page);
    await expect(pin(client(page), 'jev-answer')).toContainText('YES · 0.94');
    await expect(pin(client(page), 'jev-answer')).toContainText('simulated · stub, not a recorded Jev answer');

    await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
    await expectPending(page, 'jev (agent): type the answer');
    await expect(pin(client(page), 'jev-answer')).toHaveCount(0);
    await solve(page);
  });

  await test.step('lesson 2: Next brings the branches in; Solve replays the clean merge', async () => {
    await next(page, '2-git-merges-the-two-branches');
    await expectPending(page, 'git (agent): merge');
    // Lesson 1's reply is already there on arrival, with no Solve pressed.
    await expect(pin(client(page), 'jev-answer')).toContainText('YES · 0.94');
    await expect(pin(client(page), 'branch-airfare')).toContainText('airfare 890');
    await solve(page);
    await expect(region(client(page), 'Merge').locator('.entry')).toHaveText(['clean · 0 conflicts']);
    await expect(region(client(page), 'Budget')).toContainText('not evaluated');
  });

  await test.step('lesson 3: FAIL @ v1 with readable evidence', async () => {
    await next(page, '3-checks-evaluate-p-under-v1');
    await expectPending(page, 'checks (agent): evaluate');
    await solve(page);
    await expect(region(client(page), 'Budget').locator('.entry').first()).toContainText('FAIL @ v1: 890 + 400 = 1290 > 1200');
    await client(page).locator('.codelens-decoration a', { hasText: 'budget-exceeds-limit' }).click();
    const evidence = client(page).getByRole('region', { name: 'Diagnostic evidence' });
    await expect(evidence).toContainText('rules/limit@v1');
    await expect(evidence).toContainText('contradicted: 1290 > 1200');
  });

  await test.step('lesson 4: the permission request arrives; Solve replays the recorded grant; Reset withdraws it', async () => {
    await next(page, '4-supervisor-grants-1200-1300');
    await expectPending(page, 'supervisor (client): grant 1200 → 1300');
    await expect(log(client(page))).toContainText('worker (agent): request permission  ->  sent  session/request_permission');
    await solve(page);
    const record = region(client(page), 'Authority').locator('.entry').first();
    await expect(record.locator('.caption')).toHaveText('Recorded supervisor decision · enforcement simulated');
    await expect(pin(client(page), 'limit-v2')).toContainText('applies to Proposal P');

    await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
    await expectPending(page, 'supervisor (client): grant 1200 → 1300');
    await expect(region(client(page), 'Authority')).toContainText('not evaluated');
    await solve(page);
  });

  await test.step('lesson 5: PASS @ v2, and FAIL @ v1 is still tied to v1', async () => {
    await next(page, '5-checks-re-evaluate-p-under-v2');
    await expectPending(page, 'checks (agent): re-evaluate');
    await solve(page);
    const budget = region(client(page), 'Budget').locator('.entry');
    await expect(budget.nth(1)).toContainText('PASS @ v2: 890 + 400 = 1290 ≤ 1300');
    await expect(budget.nth(0)).toContainText('FAIL @ v1');
    await expect(budget.nth(0)).toContainText('evaluated against Limit rule v1');
    await expect(pin(client(page), 'limit-v1').locator('.text')).toHaveText('budget ≤ 1200');
    // Everything the argument rests on is on screen together, without scrolling.
    for (const id of ['question', 'jev-answer', 'proposal-P', 'limit-v1', 'limit-v2']) {
      await expect(pin(client(page), id)).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: test.info().outputPath('lesson-5-solved.png') });
  });
});
