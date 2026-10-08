import { expect, test, type Page } from '@playwright/test';

// CIT-307 / CIT-309 / CIT-328: plays each lesson the @tutorial test compiled into
// src/content/tutorial/part-5/can-an-upload-read-a-private-file inside the real
// TutorialKit app (the WebContainer-hosted Client preview, and the terminal the
// Agent prints to), using only TutorialKit's own Solve control and the keyboard.
// The editor project checks the numbers; this checks the generated lesson plays
// back through the host, including the Client -> bridge -> Agent acceptance relay.

const CHAPTER = '/part-5/can-an-upload-read-a-private-file';
const LESSONS: { path: string; subject: string; reviewer: string; lens: string; probe?: string }[] = [
  { path: `${CHAPTER}/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one`, subject: 'Can the check tell a real read of the private file', reviewer: 'bob', lens: 'review-1.finding-1.forged-read' },
  // #117's review, continued (CIT-357): it opens with the forged read accepted.
  { path: `${CHAPTER}/2-can-the-check-tell-a-real-block-from-a-generic-crash`, subject: 'Can the check tell a real read of the private file', reviewer: 'bob', lens: 'review-1.finding-2.generic-crash', probe: 'generic-crash' },
  { path: `${CHAPTER}/3-can-the-strengthened-check-tell-a-real-read-of-the-private-file-from-a-forged-one`, subject: 'Can the strengthened check tell a real read', reviewer: 'bob', lens: 'review-2.gap-1.forged-read' },
  { path: `${CHAPTER}/4-can-the-check-tell-a-real-read-of-the-private-file-from-a-mention-of-one`, subject: 'Can the check tell a real read of the private file from a mention', reviewer: 'bob', lens: 'review-2.gap-1.forged-read' },
  // Nobody reviewed the last commit: the checker itself replies.
  { path: `${CHAPTER}/5-does-the-check-require-a-real-read-of-the-private-file`, subject: 'Does the check require a real read of the private file?', reviewer: 'pkl', lens: 'review-2.gap-1.forged-read' },
];
const BOOT = { timeout: 180_000 };

const client = (page: Page) => page.frameLocator('iframe[title="Client"]');
const clientText = async (page: Page) => (await client(page).locator('.monaco-editor .view-lines').first().innerText()).replace(/\u00a0/g, ' ');
const terminal = async (page: Page) => (await page.locator('.xterm-rows').last().innerText()).replace(/\u00a0/g, ' ');

for (const [n, lesson] of LESSONS.entries()) {
  test(`the generated lesson ${n + 1} plays back in TutorialKit`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(lesson.path);

    await test.step("starts as Alice's commit, the review not yet asked for", async () => {
      await expect.poll(() => clientText(page), BOOT).toContain(lesson.subject); // the narrow preview wraps the rest
      await expect.poll(() => terminal(page), BOOT).toContain(`(${lesson.reviewer}: will `);
      // A continued lesson's carried-over finding pushes the prompt off the visible rows.
      if (!lesson.probe) expect(await terminal(page)).toContain(`alice: ${lesson.subject}`);
      expect(await terminal(page)).not.toContain(lesson.lens);
    });

    await test.step('Solve offers the probes; the findings wait for an accept', async () => {
      await page.getByRole('button', { name: 'Solve', exact: true }).click();
      await expect.poll(() => clientText(page), BOOT).toContain('Does the check fail when'); // grey suggestion
      // The terminal renders only its visible rows; the probes push "deciding what
      // to check" off the top, so the line still on screen is the one to read.
      await expect.poll(() => terminal(page), BOOT).toContain(`(${lesson.reviewer}: its findings wait until you accept a probe`);
    });

    await test.step('Tab accepts a probe and its finding follows', async () => {
      await client(page).locator('.monaco-editor').first().click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Tab');
      await expect(client(page).locator('.codelens-decoration a', { hasText: lesson.lens }).first()).toBeVisible(BOOT);
      // The finding prints, then its evidence rows; the last of them is still on screen.
      await expect.poll(() => terminal(page), BOOT).toContain(`/probes/${lesson.probe ?? 'forged-read'}/result.txt`);
    });
  });
}

// CIT-357: the handoff. Lesson 1 ends with one accepted question; lesson 2 opens
// on that, whether the learner clicks through or enters it directly. What carries
// over is the frames and the accepted finding (CIT-362): an open Peek, focus and
// scroll are view state, not progress, and nothing promises to keep them. Entering directly opens on the
// lesson's canonical checkpoint, which is not a record of what this learner did.
const FIRST = LESSONS[0];
const SECOND = LESSONS[1];
const FORGED = 'Does the check fail when a read of the private file is forged?';
async function opensOnTheForgedRead(page: Page) {
  await expect.poll(() => clientText(page), BOOT).toContain(FORGED);
  await expect(client(page).locator('.codelens-decoration a', { hasText: FIRST.lens }).first()).toBeVisible(BOOT);
  // Bob has not continued yet: Solve is still to come.
  await expect.poll(() => terminal(page), BOOT).toContain('(bob: will continue the review when you select Solve');
  expect(await clientText(page)).not.toContain('generic crash');
}

const lensLink = (page: Page, code: string) => client(page).locator('.codelens-decoration a', { hasText: code }).first();
const peek = (page: Page) => client(page).locator('.peekview-widget');
/** Open a lens's Peek: the edit Bob made, as he left it. */
async function inspect(page: Page, code: string, file: string) {
  await expect(peek(page)).toHaveCount(0);
  await lensLink(page, code).click();
  await expect(peek(page).locator('.peekview-title')).toContainText(file, BOOT);
}
const solve = (page: Page) => page.getByRole('button', { name: 'Solve', exact: true }).click();
async function tab(page: Page) {
  await client(page).locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Tab');
}
const toLesson = async (page: Page, lesson: { path: string }, title: RegExp) => {
  await page.getByRole('link', { name: title }).last().click();
  await expect(page).toHaveURL(new RegExp(lesson.path.split('/').at(-1)! + '/?$'));
};
const FIRST_TITLE = /Can the check tell a real read of the private file from a forged one/;
const SECOND_TITLE = /Can the check tell a real block from a generic crash/;

test('lesson 2 opens where lesson 1 ended, by navigation: Solve, Tab, Peek, next', async ({ page }) => {
  test.setTimeout(400_000);
  await page.goto(FIRST.path);
  await expect.poll(() => clientText(page), BOOT).toContain(FIRST.subject);
  await solve(page);
  await expect.poll(() => clientText(page), BOOT).toContain(FORGED);
  await tab(page);
  await expect(lensLink(page, FIRST.lens)).toBeVisible(BOOT);
  await inspect(page, FIRST.lens, 'canary-reads.txt@S1');

  await toLesson(page, SECOND, SECOND_TITLE);
  await opensOnTheForgedRead(page);
  // The Peek is view state, not progress; closed, the finding it showed is
  // still there to inspect again.
  if (await peek(page).count()) await peek(page).locator('.peekview-actions .codicon-close').first().click();
  await expect(peek(page)).toHaveCount(0);
  await inspect(page, FIRST.lens, 'canary-reads.txt@S1');
});

// CIT-362: both lessons share #117's review, so revisiting lesson 1 must not
// erase what was accepted in lesson 2: each lesson decides only the probes it shows.
const GENERIC = 'Does the check fail when the block is a generic crash?';
const STORED = 'acp-trace-accepted-reviews-v1';
const stored = (page: Page) => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || '{}')['cit294-review-1#0'], STORED);
async function keepsTheGenericCrash(page: Page) {
  await solve(page);
  await expect(lensLink(page, SECOND.lens)).toBeVisible(BOOT);
  await expect.poll(() => clientText(page), BOOT).toContain(GENERIC);
  // Nothing offers it again: the next suggestion is the question after it.
  await expect.poll(() => clientText(page), BOOT).toContain('Does the check fail when the trace is deleted?');
  expect(await stored(page)).toEqual([0, 1]);
}

test('accepts made in lesson 2 survive a return to lesson 1, solved or not, and a reload', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto(SECOND.path);
  await opensOnTheForgedRead(page);
  await solve(page);
  await expect.poll(() => clientText(page), BOOT).toContain(GENERIC);
  await tab(page);
  await expect(lensLink(page, SECOND.lens)).toBeVisible(BOOT);
  await expect.poll(() => stored(page), BOOT).toEqual([0, 1]);

  await test.step('back to lesson 1, unsolved, then lesson 2 again', async () => {
    await toLesson(page, FIRST, FIRST_TITLE);
    await expect.poll(() => terminal(page), BOOT).toContain('(bob: will ');
    await expect.poll(() => clientText(page), BOOT).not.toContain(FORGED);
    expect(await stored(page)).toEqual([0, 1]);
    await toLesson(page, SECOND, SECOND_TITLE);
    await opensOnTheForgedRead(page);
    await keepsTheGenericCrash(page);
  });

  await test.step('a reload keeps it', async () => {
    await page.reload();
    await opensOnTheForgedRead(page);
    await keepsTheGenericCrash(page);
  });

  await test.step('back to lesson 1, solved, then lesson 2 again', async () => {
    await toLesson(page, FIRST, FIRST_TITLE);
    await expect.poll(() => clientText(page), BOOT).toContain(FIRST.subject);
    await solve(page);
    await expect(lensLink(page, FIRST.lens)).toBeVisible(BOOT);
    await expect.poll(() => clientText(page), BOOT).not.toContain(GENERIC);
    expect(await stored(page)).toEqual([0, 1]);
    await toLesson(page, SECOND, SECOND_TITLE);
    await opensOnTheForgedRead(page);
    await keepsTheGenericCrash(page);
  });
});

test('lesson 2 opens where lesson 1 ended, by direct entry', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(SECOND.path);
  await opensOnTheForgedRead(page);
});
