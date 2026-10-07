import { readFileSync } from 'node:fs';
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

// Review 2's own two edits: the blocked arm's identity, which #118 records but
// checks for one arm only. Asked from #118 on, never of #117.
const REVIEW_2 = [
  ['review-2.gap-1.forged-read', 'Does the check fail when a read of the private file is forged?', '✗'],
  ['review-2.gap-1.deleted-trace', 'Does the check fail when the trace is deleted?', '✗'],
  ['review-2.reassessed.findings-2-3.generic-crash', 'Does the check fail when the block is a generic crash?', 'ℹ'],
  ['review-2.reassessed.findings-2-3.emptied-bytes', 'Does the check fail when the returned bytes are emptied?', 'ℹ'],
  ['review-2.reassessed.findings-2-3.corrupted-pixels', "Does the check fail when the PNG control's pixels are corrupted?", 'ℹ'],
  ['review-2.gap-2.swapped-source', 'Does the check fail when the blocked arm records a different upload?', '✗'],
  ['review-2.gap-2.changed-config', 'Does the check fail when the blocked arm records a different configuration?', '✗'],
] as const;

test("lesson 2: Alice says #118 flags every edit; Bob finds two that pass, and two more", async ({ page }) => {
  await page.goto(story('pr-118'));
  const c = client(page);
  // Lesson 1's review stays above the new commit; this commit is Alice's #118.
  await expect(c.locator('.view-lines')).toContainText('Can the strengthened check tell a real read of the private file from a forged one?');
  const editor = c.getByRole('textbox', { name: 'Editor content', exact: true });
  for (const [, question] of REVIEW_2) {
    await expect(async () => {
      const lines = (await typed(page)).split('Can the strengthened check')[1] ?? '';
      if (!lines.includes(question)) {
        expect(await shown(page)).toContain(question);
        await editor.press('Tab');
      }
      expect((await typed(page)).split('Can the strengthened check')[1]).toContain(question);
    }).toPass({ timeout: 15_000 });
  }
  const said = await markers(page);
  for (const [code, , mark] of REVIEW_2) {
    await expect(c.getByRole('button', { name: new RegExp(`${code.replace(/\./g, '\\.')}\\b`) })).toContainText(mark);
    expect(said).toContain(`${code}: `);
  }
  // Alice's claim is her forecast for each of review 1's edits; the run answers it.
  expect(said).toContain('review-2.gap-1.forged-read: Forging a read of the private file still left all 56 assertions passing. Alice claimed #118 flags it; it does not.');
  expect(said).toMatch(/review-2\.reassessed\.findings-2-3\.generic-crash: Recording the block as a generic crash made the check fail[^\n]*Alice claimed #118 flags it; it does\./);
  // Review 2's own edits carry no claim: #118 did not know of them.
  expect(said).toMatch(/review-2\.gap-2\.swapped-source: [^\n]*still left all 56 assertions passing\.$/m);

  const peek = c.locator('.peekview-widget');
  const opened = () => peek.locator('.monaco-editor').first().evaluate((element) => {
    const monaco = (element.ownerDocument.defaultView as any).monaco;
    return monaco.editor.getEditors().find((e: any) => e.getDomNode() === element).getModel().getValue() as string;
  });
  await c.getByRole('button', { name: /review-2\.gap-2\.swapped-source/ }).click();
  await expect(peek.locator('.peekview-title')).toContainText('mat-blocked.json@S2');
  await expect.poll(opened).toContain('"independent_source_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"');
  // Beside it, review 2's own words.
  const location = peek.locator('[aria-level="2"][aria-label*="in linear-CIT-297-comment-271bc302.md on line"]');
  if (!(await location.count())) await peek.locator('[aria-level="1"][aria-label*="in linear-CIT-297-comment-271bc302.md,"]').click();
  await location.first().click();
  await expect.poll(opened).toContain('Replacing the blocked MAT arm\'s source SHA with a different valid SHA still passes everything');
});

/** Accept each question below the commit whose subject is `subject`, in order. */
async function acceptAll(page: Page, subject: string, questions: readonly string[]) {
  const editor = client(page).getByRole('textbox', { name: 'Editor content', exact: true });
  const below = async () => (await typed(page)).split(subject)[1] ?? '';
  for (const question of questions) {
    await expect(async () => {
      if (!(await below()).includes(question)) {
        expect(await shown(page)).toContain(question);
        await editor.press('Tab');
      }
      expect(await below()).toContain(question);
    }).toPass({ timeout: 15_000 });
  }
}
const peekText = (page: Page) => client(page).locator('.peekview-widget .monaco-editor').first().evaluate((element) => {
  const monaco = (element.ownerDocument.defaultView as any).monaco;
  return monaco.editor.getEditors().find((e: any) => e.getDomNode() === element).getModel().getValue() as string;
});
async function openLens(page: Page, code: string) {
  const c = client(page);
  if (await c.locator('.peekview-widget').count()) await page.keyboard.press('Escape');
  await expect(c.locator('.peekview-widget')).toHaveCount(0);
  await c.getByRole('button', { name: new RegExp(`${code.replace(/\./g, '\\.')}\\b`) }).click();
  await expect(c.locator('.peekview-widget')).toBeVisible();
}

// Every question asked of #120 and its last commit: the seven before, then
// review 3's three, known second-hand.
const ALL = [
  'Does the check fail when a read of the private file is forged?',
  'Does the check fail when the trace is deleted?',
  'Does the check fail when the block is a generic crash?',
  'Does the check fail when the returned bytes are emptied?',
  "Does the check fail when the PNG control's pixels are corrupted?",
  'Does the check fail when the blocked arm records a different upload?',
  'Does the check fail when the blocked arm records a different configuration?',
  'Does the check fail when the real read is only a mention of the private file?',
  'Does the check fail when the real read is a failed open?',
  'Does the check fail when the real read is of a same-named file elsewhere?',
] as const;

test('lesson 3: #120 catches a forged trace but not an emptied one, nor a mention for a read', async ({ page }) => {
  const subject = 'Can the check tell a real read of the private file from a mention of one?';
  await page.goto(story('pr-120'));
  await expect(client(page).locator('.view-lines')).toContainText(subject);
  await acceptAll(page, subject, ALL);
  const c = client(page);
  for (const [code, mark] of [
    ['review-2.gap-1.forged-read', 'ℹ'],
    ['review-3.finding-1.deleted-trace', '✗'],
    ['review-2.reassessed.findings-2-3.generic-crash', 'ℹ'],
    ['review-2.gap-2.swapped-source', 'ℹ'],
    ['review-2.gap-2.changed-config', 'ℹ'],
    ['review-3.finding-2.prose-mention', '✗'],
    ['review-3.finding-2.failed-open', '✗'],
    ['review-3.finding-2.other-directory', '✗'],
  ] as const) await expect(c.getByRole('button', { name: new RegExp(`${code.replace(/\./g, '\\.')}\\b`) })).toContainText(mark);
  const said = await markers(page);
  expect(said).toContain('review-2.gap-1.forged-read: Forging a read of the private file made the check fail');
  expect(said).toMatch(/review-3\.finding-1\.deleted-trace: Deleting the trace still left all 71 assertions passing\. Alice claimed #120 flags it; it does not\./);
  expect(said).toMatch(/review-3\.finding-2\.prose-mention: [^\n]*still left all 71 assertions passing\.$/m);

  // From #120 on the trace is in each arm's record: the lens opens Bob's edit there.
  await openLens(page, 'review-3.finding-1.deleted-trace');
  await expect(c.locator('.peekview-title')).toContainText('mat-blocked.json@S3');
  await expect.poll(() => peekText(page)).toContain('"independent_trace_text": ""');
  await openLens(page, 'review-3.finding-2.prose-mention');
  await expect(c.locator('.peekview-title')).toContainText('mat-unblocked.json@S3');
  await expect.poll(() => peekText(page)).toContain('the app read /work/dummy-canary.txt');
  // Review 3's words are second-hand: the next commit's account of it.
  const location = c.locator('.peekview-widget [aria-level="2"][aria-label*="in git-commit-object-cc23e89297855dd07b1ee477ced455ab46a94738.txt on line"]');
  if (!(await location.count())) await c.locator('.peekview-widget [aria-level="1"][aria-label*="in git-commit-object-cc23e89297855dd07b1ee477ced455ab46a94738.txt,"]').click();
  await location.first().click();
  await expect.poll(() => peekText(page)).toContain('Review of PR #120 found the independent-read check still only did a');
});

test("lesson 4: nobody reviewed cc23e89; the checker answers every question, and catches each", async ({ page }) => {
  const subject = 'Does the check require a real read of the private file?';
  await page.goto(story('cc-23-e-89'));
  await expect(client(page).locator('.view-lines')).toContainText(subject);
  await acceptAll(page, subject, ALL);
  const c = client(page);
  await expect.poll(async () => (await c.locator('.codelens-decoration').allInnerTexts()).length).toBeGreaterThanOrEqual(ALL.length);
  const lenses = await c.locator('.codelens-decoration').allInnerTexts();
  const mine = lenses.slice(-ALL.length);
  expect(mine).toHaveLength(ALL.length);
  for (const lens of mine) expect(lens).toMatch(/^ℹ /);
  const said = await markers(page);
  for (const code of ['review-3.finding-1.deleted-trace', 'review-3.finding-2.prose-mention', 'review-3.finding-2.failed-open', 'review-3.finding-2.other-directory']) {
    expect(said).toMatch(new RegExp(`${code.replace(/\./g, '\\.')}: [^\\n]*made the check fail[^\\n]*Alice claimed #120 flags it; it does\\.`));
  }
  // The reply is the checker's, not a reviewer's: nobody reviewed this revision.
  const solved = JSON.parse(readFileSync(new URL('../src/content/tutorial/part-5/can-an-upload-read-a-private-file/4-does-the-check-require-a-real-read-of-the-private-file/_solution/acp-trace.json', import.meta.url), 'utf8'));
  const reply = solved.frames.at(-1);
  expect(reply.speaker).toBe('pkl');
  expect(reply.envelope.result._meta.diagnostic.message).toContain('No review of the final revision, cc23e89, is recorded.');
  expect(reply.envelope.result._meta.diagnostic.severity).toBe('info');
});
