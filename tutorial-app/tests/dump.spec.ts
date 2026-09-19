import { test, expect } from '@playwright/test';

test('navigate through the tutorial app', async ({ page }) => {
  await page.goto('http://localhost:4321/');
  await page.waitForTimeout(5000);

  const loc = page.locator('a[href="/part-1/chapter-1/lesson-2"]');
  for (let i = 0; i < await loc.count(); i++) {
    const html = await loc.nth(i).evaluate((el) => el.outerHTML);
    console.log(`HTML: ${html}`);
  }
});
