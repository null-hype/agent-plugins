import { expect, test } from '@playwright/test';

// IDs discovered with `storybook tools stories find-by-component`.
const lessons = [
  { id: 'lessons-private-file--pr-117', commit: 'Alice, #117:', code: 'review-1.finding-1.forged-read', outcome: 'still left all 28 assertions passing', mark: '✗' },
  { id: 'lessons-private-file--pr-118', commit: 'Alice, #118:', code: 'review-2.gap-1.forged-read', outcome: 'still left all 56 assertions passing', mark: '✗' },
  { id: 'lessons-private-file--pr-120', commit: 'Alice, #120:', code: 'review-2.gap-1.forged-read', outcome: '68 of 71 assertions passed', mark: 'ℹ' },
  { id: 'lessons-private-file--cc-23-e-89', commit: 'Alice, cc23e89', code: 'review-2.gap-1.forged-read', outcome: '72 of 75 assertions passed', mark: 'ℹ' },
];
const probe = 'Does the check fail when a read of the private file is forged?';

test('walk all four part-5 lessons: Alice commit, Solve probe, Tab finding', async ({ page }) => {
  for (const lesson of lessons) {
    await test.step(lesson.commit, async () => {
      await page.goto(`/iframe.html?id=${lesson.id}&viewMode=story`);
      const client = page.frameLocator('iframe[title="acp-trace client preview"]');
      const lines = client.locator('.view-lines');
      await client.getByRole('textbox', { name: 'Editor content', exact: true }).press('ControlOrMeta+k');
      await client.getByRole('textbox', { name: 'Editor content', exact: true }).press('ControlOrMeta+j');
      await expect(lines).toContainText(lesson.commit);
      await expect(lines).not.toContainText(probe);
      const lens = client.getByRole('button', { name: new RegExp(lesson.code.replace(/\./g, '\\.')) });
      await expect(lens).toHaveCount(0);

      // Set the existing Storybook solved control; its render calls the shim's solve().
      await page.goto(`/iframe.html?id=${lesson.id}&viewMode=story&args=solved:!true`);
      await expect(lines).toContainText(probe);
      await expect(lens).toHaveCount(0);
      await client.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
      await expect(lens).toContainText(lesson.mark);
      // The marker is the lesson's finding, not just the accepted question.
      await expect.poll(() => client.locator('body').evaluate((body) =>
        (body.ownerDocument.defaultView as any).monaco.editor.getModelMarkers({})
          .map((marker: { message: string }) => marker.message).join('\n') as string,
      )).toContain(`${lesson.code}: Forging a read of the private file ${lesson.outcome.includes('still') ? lesson.outcome : `made the check fail: ${lesson.outcome}`}`);

    });
  }
});
