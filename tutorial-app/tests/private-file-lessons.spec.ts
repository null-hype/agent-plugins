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

  // Each lens opens the edit itself first: the record or trace as Bob left it.
  const peek = c.locator('.peekview-widget');
  const opened = () => peek.locator('.monaco-editor').first().evaluate((element) => {
    const monaco = (element.ownerDocument.defaultView as any).monaco;
    return monaco.editor.getEditors().find((e: any) => e.getDomNode() === element).getModel().getValue() as string;
  });
  const lens = async (code: string) => {
    if (await peek.count()) await page.keyboard.press('Escape');
    await expect(peek).toHaveCount(0);
    await c.getByRole('button', { name: new RegExp(code.replace(/\./g, '\\.')) }).click();
    await expect(peek).toBeVisible();
  };
  for (const [code, file, holds] of [
    ['review-1.finding-2.generic-crash', 'mat-blocked.json@S1', '"variant_error": "RuntimeError: disk full"'],
    ['review-1.finding-3.emptied-bytes', 'mat-unblocked.json@S1', '"returned_bytes_hex": ""'],
    ['review-1.finding-3.corrupted-pixels', 'png-blocked.json@S1', '"returned_bytes_hex": "ffffffff"'],
    // The forged read: the trace with the private file's openat added to the blocked arm.
    ['review-1.finding-1.forged-read', 'canary-reads.txt@S1', '"/work/dummy-canary.txt", O_RDONLY) = 14'],
    // The deleted trace: the whole transcript Bob removed, as it was retained.
    ['review-1.finding-1.deleted-trace', 'canary-reads.txt@S1', '### ARM: mat-blocked'],
  ] as const) {
    await lens(code);
    await expect(peek.locator('.peekview-title')).toContainText(file);
    await expect.poll(opened).toContain(holds);
  }

  // Beside the edit: the review's own words and the run's result, as files, not
  // summaries. Only the reviewers' own run output, which nobody kept, is one.
  await lens('review-1.finding-2.generic-crash');
  for (const [group, holds] of [
    ['linear-CIT-294-comment-97e70a90.md', '**A generic variant crash passes as successful blocking.**'],
    ['result.txt@S1', 'mutation: the blocked MAT arm refused with RuntimeError: disk full'],
  ] as const) {
    const location = peek.locator(`[aria-level="2"][aria-label*="in ${group} on line"]`);
    if (!(await location.count())) await peek.locator(`[aria-level="1"][aria-label*="in ${group},"]`).click();
    await location.first().click();
    await expect.poll(opened).toContain(holds);
    expect(await opened()).not.toContain('Evidence summary');
  }
});
