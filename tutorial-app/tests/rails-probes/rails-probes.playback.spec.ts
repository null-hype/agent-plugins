import { expect, test, type Page } from '@playwright/test';

// CIT-307 / CIT-309: plays each lesson the @tutorial test compiled into
// src/content/tutorial/part-4/can-the-checker-be-trusted inside the real
// TutorialKit app (WebContainer-hosted Client and Agent previews), using only
// TutorialKit's own Solve control and the keyboard. The editor project checks
// the numbers; this checks the generated lesson plays back through the host,
// including the Client -> bridge -> Agent acceptance relay.

const CHAPTER = '/part-4/can-the-checker-be-trusted';
const LESSONS = [
  { path: `${CHAPTER}/1-can-the-check-tell-a-real-file-read-from-a-forged-one`, subject: 'CIT-294: Can the check tell a real file read from', finding: 'review-1.finding-1', lens: 'review-1.finding-1.deleted-trace' },
  { path: `${CHAPTER}/2-can-the-strengthened-check-tell-a-real-file-read-from-a-forged-one`, subject: 'CIT-297: Can the strengthened check tell a real', finding: 'review-2.gap-1', lens: 'review-2.gap-1.deleted-trace' },
];
const BOOT = { timeout: 180_000 };

const client = (page: Page) => page.frameLocator('iframe[title="Client"]');
const agent = (page: Page) => page.frameLocator('iframe[title="Agent"]');
const clientText = async (page: Page) => (await client(page).locator('.monaco-editor .view-lines').innerText()).replace(/ /g, ' ');

for (const [n, lesson] of LESSONS.entries()) {
  test(`the generated lesson ${n + 1} plays back in TutorialKit`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(lesson.path);

    await test.step('starts as a question with no answer', async () => {
      await expect.poll(() => clientText(page), BOOT).toContain(lesson.subject); // the narrow preview wraps the rest
      // The prompt and a "Reviewing…" placeholder; no finding yet.
      await expect(agent(page).locator('#chat-view')).toContainText('Reviewing', BOOT);
      await expect(agent(page).locator('#chat-view')).not.toContainText(lesson.finding);
    });

    await test.step('Solve offers the probes; the Agent is still deciding', async () => {
      await page.getByRole('button', { name: 'Solve', exact: true }).click();
      await expect.poll(() => clientText(page), BOOT).toContain('Does the check fail when the'); // grey suggestion, wrapped by the narrow preview
      await expect(agent(page).locator('#chat-view')).toContainText('Deciding what to check', BOOT);
      await expect(agent(page).locator('#chat-view')).not.toContainText(lesson.finding);
    });

    await test.step('Tab accepts a probe and the Agent then diagnoses', async () => {
      await client(page).locator('.monaco-editor').first().click();
      await page.keyboard.press('Tab');
      await expect(agent(page).locator('#chat-view')).toContainText(lesson.finding, BOOT);
      await expect(client(page).locator('.codelens-decoration a', { hasText: lesson.lens })).toBeVisible();
    });

    // CIT-301: through AcpTraceBridge, the TutorialKit host. Review 1's forged-read
    // evidence cites a captured file; review 2's rows are summary text only.
    if (n === 0) {
      await test.step('the Reconcile.pkl row opens the exact file review 1 read', async () => {
        await page.keyboard.press('Tab'); // the second probe; accepting both first keeps focus in the editor
        await client(page).locator('.codelens-decoration a', { hasText: 'review-1.finding-1.forged-read' }).click();
        const widget = client(page).getByRole('region', { name: 'Diagnostic evidence' });
        await expect(widget.getByRole('button', { name: /Open captured file/ })).toHaveCount(1);
        await widget.getByRole('button', { name: /Open captured file/ }).click();
        const file = client(page).getByRole('region', { name: 'Captured file docs/investigations/CIT-265/cit-294/Reconcile.pkl' });
        await expect(file).toContainText('revision:20aafd26372a832224be824f72f4a615ee671094', BOOT);
        await expect(file).toContainText('line 17');
        await expect(file.locator('.highlight')).toHaveCount(1);
        await expect(file.locator('.highlight')).toContainText('function check(claim: Claims.Claim, observed: Observation.Observed)');
      });
    }
  });
}
