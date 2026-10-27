import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`portfolio front door: navigation and keyboard access at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?path=/story/portfolio-landing--front-door');
    await page.getByRole('tab', { name: /^Interactions/ }).click();
    await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
  });
}
