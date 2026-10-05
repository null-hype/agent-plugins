import { expect, test, type Page } from '@playwright/test';

// CIT-307: plays the lesson the @tutorial test compiled into
// src/content/tutorial/part-4/can-the-check-in-117-be-trusted inside the real
// TutorialKit app (WebContainer-hosted Client and Agent previews), using only
// TutorialKit's own Solve control and the keyboard. The editor project checks
// the numbers; this checks the generated lesson plays back through the host,
// including the Client -> bridge -> Agent acceptance relay.

const LESSON = '/part-4/can-the-check-in-117-be-trusted/1-can-the-check-tell-a-real-file-read-from-a-forged-one';
const BOOT = { timeout: 180_000 };

const client = (page: Page) => page.frameLocator('iframe[title="Client"]');
const agent = (page: Page) => page.frameLocator('iframe[title="Agent"]');
const clientText = async (page: Page) => (await client(page).locator('.monaco-editor .view-lines').innerText()).replace(/ /g, ' ');

test('the generated review-1 lesson plays back in TutorialKit', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(LESSON);

  await test.step('starts as a question with no answer', async () => {
    await expect.poll(() => clientText(page), BOOT).toContain('CIT-294: Can the check tell a real file read from'); // the narrow preview wraps the rest
    // The prompt and a "Reviewing…" placeholder; no finding yet.
    await expect(agent(page).locator('#chat-view')).toContainText('Reviewing', BOOT);
    await expect(agent(page).locator('#chat-view')).not.toContainText('review-1.finding-1');
  });

  await test.step('Solve offers the probes; the Agent is still deciding', async () => {
    await page.getByRole('button', { name: 'Solve', exact: true }).click();
    await expect.poll(() => clientText(page), BOOT).toContain('Does the check fail when the'); // grey suggestion, wrapped by the narrow preview
    await expect(agent(page).locator('#chat-view')).toContainText('Deciding what to check', BOOT);
    await expect(agent(page).locator('#chat-view')).not.toContainText('review-1.finding-1');
  });

  await test.step('Tab accepts a probe and the Agent then diagnoses', async () => {
    await client(page).locator('.monaco-editor').first().click();
    await page.keyboard.press('Tab');
    await expect(agent(page).locator('#chat-view')).toContainText('review-1.finding-1', BOOT);
    await expect(client(page).locator('.codelens-decoration a', { hasText: 'review-1.finding-1.deleted-trace' })).toBeVisible();
  });
});
