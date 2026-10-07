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
  const box = c.getByRole('textbox', { name: 'Editor content', exact: true });
  await c.locator('.ghost-text-decoration').first().waitFor();

  await box.press('Tab');
  await expect.poll(() => modelText(c)).toMatch(/\n# Was Meridian ever exposed to CVE-2026-66066\? Forecast: 50% yes\.\n$/);
  await expect(c.locator('.acp-heading').first()).toBeVisible();
  await expect(c.locator('.ghost-text-decoration').first()).toContainText('Would an uploaded file');
  // The root's finding is the split: two versions of the tree and of Pkl's
  // frozen reading, base (5282c7e) then head (12f2351), nothing else.
  const evidence = async () => c.locator('.peekview-widget .monaco-editor').evaluate((element) => {
    const monaco = (element.ownerDocument.defaultView as any).monaco;
    const editor = monaco.editor.getEditors().find((e: any) => e.getDomNode() === element);
    return { text: editor.getModel().getValue(), readOnly: editor.getOption(monaco.editor.EditorOption.readOnly) };
  });
  const peek = c.locator('.peekview-widget');
  await c.getByRole('button', { name: /question\.split\W+5 related/ }).click();
  await expect(peek).toBeVisible();
  const groups = await peek.locator('[aria-level="1"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/.*full path \/captured\/([^/]+)\/.*\/(\S+)$/, '$1 $2')));
  expect(groups).toEqual(['split-base@5282c7e WasIVulnerable.pkl', 'split-base@5282c7e WasIVulnerable.test.pkl-expected.pcf',
    'split-head@12f2351 WasIVulnerable.pkl', 'split-head@12f2351 WasIVulnerable.test.pkl-expected.pcf']);
  const frozen = (commit: string, file: string) => readFileSync(new URL(`../src/stories/frozen/${commit}/${file}`, import.meta.url), 'utf8');
  for (const [side, file, text] of [
    ['split-base@5282c7e', 'WasIVulnerable.test.pkl-expected.pcf', /new \{\}\s*\}$/],
    ['split-head@12f2351', 'WasIVulnerable.pkl', /Round 1 splits the root/],
    ['split-head@12f2351', 'WasIVulnerable.test.pkl-expected.pcf', /implied = 0\.32/],
  ] as const) {
    const group = peek.getByRole('treeitem', { name: new RegExp(`${side}/.*/${file.replace(/\./g, '\\.')}$`) });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    // The location itself, under its side's group (both sides hold this file).
    await peek.locator(`[aria-level="2"][aria-label*="${file} on line"]`).filter({ hasText: text }).click();
    await expect.poll(evidence).toEqual({ text: frozen(side.split('@')[1], file), readOnly: true });
  }
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  // A Tab with the cursor off the suggestion line is taken back, not a reset.
  await box.press('Tab');
  await expect.poll(() => modelText(c)).toMatch(/\n# Was Meridian ever exposed to CVE-2026-66066\? Forecast: 50% yes\.\n$/);
  // Back on the suggestion line, the next question is offered again.
  await box.press('Control+End');
  await expect(c.locator('.ghost-text-decoration').first()).toContainText('Would an uploaded file');

  await box.press('Tab');
  await expect(c.locator('.ghost-text-decoration').first()).toContainText('Could an attacker');
  // One of the two questions is not enough to combine them.
  await expect(c.getByRole('button', { name: /question\.split/ })).toHaveCount(1);
  await expect(c.getByRole('button', { name: /forecast\.registered/ })).toHaveCount(1);
  await expect(c.getByRole('button', { name: /forecast\.split/ })).toHaveCount(0);

  await box.press('Tab');
  const split = c.getByRole('button', { name: /forecast\.split/ });
  await expect(split).toBeVisible();
  await expect(split).toContainText('forecast.split');
  await expect(c.locator('.ghost-text-decoration')).toHaveCount(0);

  await split.click();
  await expect(peek).toBeVisible();
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

test('accepting one question reports only that question to the host', async ({ page }) => {
  await page.goto('/iframe.html?id=lessons-private-document--baseline&viewMode=story&args=solved:!true');
  // Part 5 runs the Client alone, as TutorialKit does.
  await expect(page.locator('iframe[title="acp-trace agent preview"]')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).reported = [];
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'acp-trace-suggestion-accepted') (window as any).reported.push(event.data.order);
    });
  });
  const c = client(page);
  await c.locator('.ghost-text-decoration').first().waitFor();
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  await expect(c.getByRole('button', { name: /baseline-alice-reads/ })).toBeVisible();
  await expect(c.getByRole('button', { name: /baseline-bob-reads/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).reported.at(-1))).toEqual([0]);
});
