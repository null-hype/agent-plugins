import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const client = (page: import('@playwright/test').Page) => page.frameLocator('iframe[title="acp-trace client preview"]');
const round = '../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/';

test('forecast Peek navigates original captured files, stays read-only, and closes without duplicating models', async ({ page }) => {
  await page.goto('/iframe.html?id=replay-forecast-registration--root-question&viewMode=story&args=solved:!true');
  const c = client(page);
  await c.locator('.ghost-text-decoration').first().waitFor();
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  const lens = c.getByRole('button', { name: /forecast.registered/ });
  await lens.click();
  const peek = c.locator('.peekview-widget');
  await expect(peek).toBeVisible();
  await expect(peek.getByRole('tree', { name: 'References' })).toBeVisible();

  const evidence = async () => c.locator('.peekview-widget .monaco-editor').evaluate((element) => {
    const monaco = (element.ownerDocument.defaultView as any).monaco;
    const editor = monaco.editor.getEditors().find((e: any) => e.getDomNode() === element);
    return { text: editor.getModel().getValue(), readOnly: editor.getOption(monaco.editor.EditorOption.readOnly) };
  });
  for (const file of ['register.json', 'monitor.json']) {
    const group = peek.getByRole('treeitem', { name: new RegExp(`^1 symbol in ${file.replace('.', '\\.')},`) });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    // Selecting the file expands its reference; select that precise location.
    await peek.getByRole('treeitem', { name: new RegExp(`in ${file.replace('.', '\\.')} on line`) }).click();
    const original = readFileSync(new URL(round + file, import.meta.url), 'utf8');
    await expect.poll(evidence).toEqual({ text: original, readOnly: true });
  }
  const countModels = () => c.locator('body').evaluate((el) => (el.ownerDocument.defaultView as any).monaco.editor.getModels().length);
  const count = await countModels();
  await lens.click();
  await expect(peek).toHaveCount(0);
  await lens.click();
  await expect(peek).toBeVisible();
  expect(await countModels()).toBe(count);
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
});

test('review without captured source exposes an explicit summary in native Peek', async ({ page }) => {
  await page.goto('/iframe.html?id=lessons-private-document--baseline&viewMode=story&args=solved:!true');
  const c = client(page);
  await c.locator('.ghost-text-decoration').first().waitFor();
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  await c.getByRole('button', { name: /baseline-alice-reads/ }).click();
  const peek = c.locator('.peekview-widget');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('Evidence summary');
  await expect(c.locator('.evidence-widget')).toHaveCount(0);
});

test('accepting one question reveals only that question\'s finding in the Agent pane', async ({ page }) => {
  await page.goto('/iframe.html?id=lessons-private-document--baseline&viewMode=story&args=solved:!true');
  const c = client(page);
  const agent = page.frameLocator('iframe[title="acp-trace agent preview"]');
  await c.locator('.ghost-text-decoration').first().waitFor();
  await expect(agent.locator('#chat-view')).toContainText('Deciding what to check');
  // The first ghost-text alternative is Alice's question.
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  await expect(c.getByRole('button', { name: /baseline-alice-reads/ })).toBeVisible();
  await expect(agent.locator('#chat-view')).toContainText('expected 0–20%');
  await expect(agent.locator('#chat-view')).not.toContainText('expected 80–100%');
});
