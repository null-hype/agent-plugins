import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const lesson = new URL('../src/content/tutorial/part-1/chapter-1/lesson-1/', import.meta.url);
const starter = readFileSync(new URL('_files/PersonalVocabulary.pkl', lesson), 'utf8');
const solution = readFileSync(new URL('_solution/PersonalVocabulary.pkl', lesson), 'utf8');

test('proposal and vocabulary changes update visible feedback and a late preview', async ({ page }) => {
  let delayedPreviewDocuments = 0;
  // The old bridge stopped publishing after 6.4 seconds. Hold the real
  // preview document beyond that window, then check startup and reload.
  await page.route(/4173.*webcontainer-api\.io\//, async (route) => {
    if (route.request().resourceType() === 'document') {
      delayedPreviewDocuments += 1;
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
    await route.continue();
  });
  await page.goto('/part-1/chapter-1/lesson-1/');
  const panel = page.getByRole('region', { name: 'Lesson validation' });
  const feedback = panel.getByRole('status');
  const editor = page.getByRole('textbox', { name: 'Editor', exact: true });
  await expect(feedback).toContainText('requires the source form');

  await editor.fill('Schadenfreude');
  await expect(feedback).toContainText('pass the second check');
  await panel.getByRole('button', { name: 'Open vocabulary' }).click();
  await expect(editor).toContainText('module PersonalVocabulary');
  await editor.fill(solution);
  await expect(feedback).toContainText('Accepted by this lesson');

  const preview = page.frameLocator('#previews-container iframe');
  await expect(preview.locator('.view-lines')).toContainText('loanword(Schadenfreude) -> admitted', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Reload Preview' }).click();
  await expect(preview.locator('.view-lines')).toContainText('loanword(Schadenfreude) -> admitted', { timeout: 30_000 });
  expect(delayedPreviewDocuments).toBeGreaterThanOrEqual(2);

  await editor.fill(starter);
  await expect(feedback).toContainText('pass the second check');
  await expect(preview.locator('.view-lines')).toContainText('pending admission');

  await panel.getByRole('button', { name: 'Edit proposal' }).click();
  await editor.fill('');
  await expect(feedback).toContainText('Enter a proposal');
  await editor.fill('malicious joy');
  await expect(feedback).toContainText('requires the source form');
  await expect(preview.locator('.view-lines')).toContainText('loss');

  await panel.getByText('Inspect the rule and runtime', { exact: true }).click();
  await expect(panel).toContainText('does not regenerate the runtime JSON');
  await panel.getByRole('button', { name: 'View Pkl rule' }).click();
  await expect(editor).toContainText('module LoanwordRules');
  await panel.getByRole('button', { name: 'View runtime JSON' }).click();
  await expect(editor).toContainText('canonicalTranslation');
});
