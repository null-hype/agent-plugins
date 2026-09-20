import { test, expect } from '@playwright/test';

test('navigate through the tutorial app', async ({ page }) => {
  console.log('Navigating to http://localhost:4321/');
  await page.goto('http://localhost:4321/');
  
  await page.waitForTimeout(3000);

  let currentUrl = page.url();
  
  for (let i = 0; i < 30; i++) {
    const title = await page.title();
    console.log(`Step ${i + 1}: ${title} - ${page.url()}`);

    // If there is a "Solve" button, click it. Wait for it to apply.
    const solveButton = page.locator('button:has-text("Solve")');
    if (await solveButton.count() > 0 && await solveButton.first().isVisible()) {
      console.log('Found "Solve" button. Clicking to apply solution...');
      try {
        await solveButton.first().click({ force: true, timeout: 2000 });
      } catch (e) {}
      await page.waitForTimeout(2000); // Wait for WebContainer to run solution
    }

    // Sometimes a "Run" button or similar is there
    const runButton = page.locator('button:has-text("Run")');
    if (await runButton.count() > 0 && await runButton.first().isVisible()) {
        console.log('Found "Run" button. Clicking to run code...');
        try {
          await runButton.first().click({ force: true, timeout: 2000 });
        } catch (e) {}
        await page.waitForTimeout(2000);
    }

    // Now look for the next button
    const nextButton = page.locator('a:has(span.i-ph-arrow-right)');
    
    let clicked = false;
    if (await nextButton.count() > 0) {
      for (let j = 0; j < await nextButton.count(); j++) {
        const el = nextButton.nth(j);
        if (await el.isVisible()) {
          console.log('Clicking next link...');
          try {
            await el.click({ force: true, timeout: 2000 });
            clicked = true;
            break;
          } catch (e) {}
        }
      }
    }

    if (!clicked) {
      console.log('No next link found. Reached the end or stuck.');
      break;
    }
    
    // wait for navigation to the new URL
    try {
      await page.waitForURL((url) => url.toString() !== currentUrl, { timeout: 10000 });
      currentUrl = page.url();
      await page.waitForTimeout(2000); // Give it a bit to load the webcontainer environment
    } catch (e) {
      console.log('Navigation did not complete or URL did not change in 10s.');
      break;
    }
  }

  console.log('Tutorial QA run completed.');
});
