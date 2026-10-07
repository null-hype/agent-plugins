import { expect, test, type Page } from '@playwright/test';

// Part 5, "Can an upload read a private file?": the 117 -> 118 -> 120 history as
// the tutorial reporter generated it. Each lesson is one pull request and its
// review: Alice's commit is the starter, and Solve is Bob's review, whose
// questions are the edits he made to the recorded evidence. The checker each
// lesson replays is the pinned one, run for real when the lessons were generated.
const story = (name: string) => `/iframe.html?id=lessons-private-file--${name}&viewMode=story&args=solved:!true`;
const client = (page: Page) => page.frameLocator('iframe[title="acp-trace client preview"]');
const markers = (page: Page) => client(page).locator('body').evaluate((el) =>
  (el.ownerDocument.defaultView as any).monaco.editor.getModelMarkers({}).map((m: any) => m.message).join('\n') as string);
// What the editor shows, grey suggestions included (Monaco splits them across spans).
const shown = (page: Page) => client(page).locator('.view-lines').first().innerText().then((t) => t.replace(/\u00a0/g, ' '));
const typed = (page: Page) => client(page).locator('body').evaluate((el) =>
  (el.ownerDocument.defaultView as any).monaco.editor.getModels()[0].getValue() as string);

// Review 1's edits, in the order Bob offers them.
const REVIEW_1 = [
  ['review-1.finding-1.forged-read', 'Does the check fail when a read of the private file is forged?'],
  ['review-1.finding-1.deleted-trace', 'Does the check fail when the trace is deleted?'],
  ['review-1.finding-2.generic-crash', 'Does the check fail when the block is a generic crash?'],
  ['review-1.finding-3.emptied-bytes', 'Does the check fail when the returned bytes are emptied?'],
  ['review-1.finding-3.corrupted-pixels', "Does the check fail when the PNG control's pixels are corrupted?"],
] as const;

test('lesson 1: Alice says #117 passes; each of Bob\'s edits still passes it', async ({ page }) => {
  await page.goto(story('pr-117'));
  const c = client(page);
  // Alice's commit: the question, and her claim, quoted from #117.
  await expect(c.locator('.view-lines')).toContainText('Can the check tell a real read of the private file from a forged one?');
  const editor = c.getByRole('textbox', { name: 'Editor content', exact: true });

  // Bob's review: each question is an edit to the recorded evidence.
  for (const [, question] of REVIEW_1) {
    // The editor re-renders after each accept and offers the next suggestion
    // again; a Tab with nothing on offer is taken back, so retry until it lands.
    await expect(async () => {
      expect(await shown(page)).toContain(question);
      await editor.press('Tab');
      expect(await typed(page)).toContain(question);
    }).toPass({ timeout: 15_000 });
  }
  const said = await markers(page);
  for (const [code] of REVIEW_1) {
    await expect(c.getByRole('button', { name: new RegExp(code.replace(/\./g, '\\.')) })).toContainText('✗');
    expect(said).toContain(`${code}: `);
  }
  expect(said).toContain('still left all 28 assertions passing');

  // The lens opens the edit itself: the blocked arm's record, as Bob changed it.
  await c.getByRole('button', { name: /review-1\.finding-2\.generic-crash/ }).click();
  const peek = c.locator('.peekview-widget');
  await expect(peek.locator('.peekview-title')).toContainText('mat-blocked.json@S1');
  await expect(peek.locator('.monaco-editor').first()).toContainText('RuntimeError: disk full');
});
