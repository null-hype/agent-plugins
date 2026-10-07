import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const client = (page: import('@playwright/test').Page) => page.frameLocator('iframe[title="acp-trace client preview"]');
const round = '../../src/cve-2026-66066/questions/rounds/20261006T065648Z-stub/';

const tree = '../../src/cve-2026-66066/questions/';
const modelText = (c: ReturnType<typeof client>) => c.locator('body').evaluate((el) =>
  (el.ownerDocument.defaultView as any).monaco.editor.getModels()[0].getValue() as string);

test('focus on the suggestion shows what accepting it unfolds', async ({ page }) => {
  await page.goto('/iframe.html?id=replay-forecast-registration--root-question&viewMode=story&args=solved:!true');
  const c = client(page);
  await c.locator('.ghost-text-decoration').first().waitFor();
  await c.locator('body').evaluate((el) => {
    const editor = (el.ownerDocument.defaultView as any).monaco.editor.getEditors()[0];
    editor.focus();
    return editor.getAction('editor.action.showHover').run();
  });
  const hover = c.locator('.monaco-hover:visible').filter({ hasText: 'unfolds' });
  await expect(hover).toContainText('Was Meridian ever exposed to CVE-2026-66066? Forecast: 50% yes.');
  await expect(hover).toContainText("Would an uploaded file reach libvips' matload?");
  await expect(hover).toContainText('Could an attacker get a crafted upload rendered?');
});

test('Tab unfolds the root into a heading and its questions; the split shows once both are accepted', async ({ page }) => {
  await page.goto('/iframe.html?id=replay-forecast-registration--root-question&viewMode=story&args=solved:!true');
  const c = client(page);
  const agent = page.frameLocator('iframe[title="acp-trace agent preview"]').locator('#chat-view');
  const box = c.getByRole('textbox', { name: 'Editor content', exact: true });
  await c.locator('.ghost-text-decoration').first().waitFor();

  await box.press('Tab');
  await expect.poll(() => modelText(c)).toMatch(/\n# Was Meridian ever exposed to CVE-2026-66066\? Forecast: 50% yes\.\n$/);
  await expect(c.locator('.acp-heading').first()).toBeVisible();
  await expect(c.locator('.ghost-text-decoration').first()).toContainText('Would an uploaded file');
  await box.press('Tab');
  await expect(c.locator('.ghost-text-decoration').first()).toContainText('Could an attacker');
  // One of the two questions is not enough to combine them.
  await expect(c.getByRole('button', { name: /forecast\.registered/ })).toHaveCount(2);
  await expect(c.getByRole('button', { name: /forecast\.split/ })).toHaveCount(0);
  await expect(agent).not.toContainText('imply 32%');

  await box.press('Tab');
  const split = c.getByRole('button', { name: /forecast\.split/ });
  await expect(split).toBeVisible();
  await expect(agent).toContainText('imply 32% read as independent (40% × 80%): a difference of -0.18');
  await expect(c.locator('.ghost-text-decoration')).toHaveCount(0);

  await split.click();
  const peek = c.locator('.peekview-widget');
  await expect(peek).toBeVisible();
  const evidence = async () => c.locator('.peekview-widget .monaco-editor').evaluate((element) => {
    const monaco = (element.ownerDocument.defaultView as any).monaco;
    const editor = monaco.editor.getEditors().find((e: any) => e.getDomNode() === element);
    return { text: editor.getModel().getValue(), readOnly: editor.getOption(monaco.editor.EditorOption.readOnly) };
  });
  // Registration and read-back are separate locations in the retained log.
  for (const [file, line] of [['WasIVulnerable.pkl', 46], ['monitor.json', 8], ['monitor.json', 32]] as const) {
    const group = peek.getByRole('treeitem', { name: new RegExp(`symbols? in ${file.replace('.', '\\.')},`) });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    await peek.getByRole('treeitem', { name: new RegExp(`in ${file.replace('.', '\\.')} on line ${line} `) }).click();
    const original = readFileSync(new URL((file.endsWith('.pkl') ? tree : round) + file, import.meta.url), 'utf8');
    await expect.poll(evidence).toEqual({ text: original, readOnly: true });
  }
  const countModels = () => c.locator('body').evaluate((el) => (el.ownerDocument.defaultView as any).monaco.editor.getModels().length);
  const count = await countModels();
  await split.click();
  await expect(peek).toHaveCount(0);
  await split.click();
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
