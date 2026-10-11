import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// CIT-397 step: record what the browser shows for one case after the story's
// own play run, as `cases/<hash>/rendered.json`. This writes evidence, it
// asserts nothing about it; Rendered.test.pkl holds the facts.
//
//   RAILS_CLAIM=fddf74bea9 npx playwright test --config=playwright.rails-claims.config.ts

const hash = process.env.RAILS_CLAIM ?? 'fddf74bea9';
const out = new URL(`../../src/lesson-farms/rails-claims/cases/${hash}/rendered.json`, import.meta.url);

// The editor as Monaco holds it, plus the CodeLens titles and squiggles as drawn.
const view = (page: Page) => page.evaluate(() => {
  const monaco = (window as any).monaco;
  const editor = monaco.editor.getEditors()[0];
  const model = editor.getModel();
  const root = editor.getDomNode() as HTMLElement;
  return {
    path: (document.querySelector('[data-testid="investigation-path"] span')?.textContent ?? '').replace(/ /g, ' '),
    uri: model.uri.toString(true),
    text: model.getValue(),
    markers: monaco.editor.getModelMarkers({ resource: model.uri }).map((m: any) => ({
      line: m.startLineNumber, column: m.startColumn, endColumn: m.endColumn, message: m.message,
    })),
    squiggles: root.querySelectorAll('.squiggly-warning').length,
    lenses: Array.from(root.querySelectorAll('.codelens-decoration > a, .codelens-decoration > span'))
      .map((e) => (e.textContent ?? '').replace(/ /g, ' ').trim())
      .filter((t) => t && t !== '|'),
  };
});

test(`rails claim ${hash}: what the reviewer is shown`, async ({ page }) => {
  await page.goto('/iframe.html?id=investigations-rails-commit-claims--the-frame-the-evidence-supports&viewMode=story');
  // The play run ends on the payload the "always" lens opened.
  await page.locator('.codelens-decoration', { hasText: 'not sent yet' }).waitFor();
  const payload = await view(page);
  // Back to the commit message, where the play run started.
  await page.getByRole('button', { name: /COMMIT_EDITMSG/ }).click();
  await page.locator('.codelens-decoration', { hasText: 'Jev' }).first().waitFor();
  await expect.poll(async () => (await view(page)).squiggles).toBeGreaterThan(0);
  const commit = await view(page);
  writeFileSync(out, JSON.stringify({ commit, payload }, null, 1) + '\n');
});
