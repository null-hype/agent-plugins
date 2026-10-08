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
// on exactly that, whether the learner clicks through or enters it directly.
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

test('lesson 2 opens where lesson 1 ended, by navigation', async ({ page }) => {
  test.setTimeout(400_000);
  await page.goto(FIRST.path);
  await expect.poll(() => clientText(page), BOOT).toContain(FIRST.subject);
  await page.getByRole('button', { name: 'Solve', exact: true }).click();
  await expect.poll(() => clientText(page), BOOT).toContain(FORGED);
  await client(page).locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Tab');
  await expect(client(page).locator('.codelens-decoration a', { hasText: FIRST.lens }).first()).toBeVisible(BOOT);

  await page.getByRole('link', { name: /Can the check tell a real block from a generic crash/ }).last().click();
  await expect(page).toHaveURL(new RegExp(SECOND.path.split('/').at(-1)!));
  await opensOnTheForgedRead(page);
});

test('lesson 2 opens where lesson 1 ended, by direct entry', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(SECOND.path);
  await opensOnTheForgedRead(page);
});
