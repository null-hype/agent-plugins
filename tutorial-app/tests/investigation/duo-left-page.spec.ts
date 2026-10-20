import { expect, test } from '@playwright/test';

test('the Duo left page story: read-only claim, a marker per card, preview and clear', async ({ page }) => {
  await page.goto('/?path=/story/duo-left-page--the-claim-with-its-cards');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  // storyFinished also fires when play throws; require the panel's Pass status.
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
});
