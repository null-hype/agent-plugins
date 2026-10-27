import { expect, test } from '@playwright/test';

test('portfolio front door: evidence navigation and keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?path=/story/portfolio-landing--front-door');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
});
