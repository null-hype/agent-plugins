import { expect, test, type Page } from '@playwright/test';

// The shared model's lessons as the tutorial reporter generated them: each a
// turn of one review, Solve the reviewer's reply. Pkl evaluates each revision
// when the lessons are generated; the lessons replay what it said.
const story = (name: string) => `/iframe.html?id=lessons-shared-model--${name}&viewMode=story&args=solved:!true`;
const client = (page: Page) => page.frameLocator('iframe[title="acp-trace client preview"]');
const markers = (page: Page) => client(page).locator('body').evaluate((el) =>
  (el.ownerDocument.defaultView as any).monaco.editor.getModelMarkers({}).map((m: any) => m.message).join('\n') as string);
const groups = (page: Page) => client(page).locator('.peekview-widget [aria-level="1"]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('aria-label')!));

test('lesson 1: Pkl accepts the committed model', async ({ page }) => {
  await page.goto(story('committed'));
  const c = client(page);
  await expect(c.locator('.ghost-text-decoration').first()).toContainText("Can Alice read Bob's private document?");
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  const lens = c.getByRole('button', { name: /baseline-alice-reads/ });
  await expect(lens).toContainText('ℹ');
  expect(await markers(page)).toContain('Pkl accepts aliceReads = 0.05');
  await lens.click();
  await expect(c.locator('.peekview-widget')).toBeVisible();
  // The committed file itself, not a summary of it.
  await expect(c.locator('.peekview-widget')).not.toContainText('Evidence summary');
  // One location, so Peek shows no list: its title names the file.
  await expect(c.locator('.peekview-widget .peekview-title')).toContainText('revisions/baseline');
});

test("lesson 2: Pkl rejects Alice's edit, and Peek holds both revisions", async ({ page }) => {
  await page.goto(story('alice-edit'));
  const c = client(page);
  await expect(c.locator('.ghost-text-decoration').first()).toContainText("Can Alice read Bob's private document?");
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  const lens = c.getByRole('button', { name: /alice-alice-reads/ });
  await expect(lens).toContainText('✗');
  const said = await markers(page);
  expect(said).toContain('Type constraint `this <= 0.5` violated.');
  expect(said).toContain('Value: 0.8');
  await lens.click();
  await expect(c.locator('.peekview-widget')).not.toContainText('Evidence summary');
  const files = (await groups(page)).join('\n');
  expect(files).toMatch(/revisions\/baseline\/PrivateDocument\.pkl/);
  expect(files).toMatch(/revisions\/alice\/PrivateDocument\.pkl/);
});

test('lesson 3: Alice loosens the type, Pkl accepts her value, and the leak is the finding', async ({ page }) => {
  await page.goto(story('loosened'));
  const c = client(page);
  await expect(c.locator('.ghost-text-decoration').first()).toContainText("Can Alice read Bob's private document?");
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');
  const lens = c.getByRole('button', { name: /loosened-alice-reads/ });
  await expect(lens).toContainText('✗');
  // Pkl raises nothing: the type now admits 0.8. The Question does not.
  const said = await markers(page);
  expect(said).toContain('Pkl accepts aliceReads = 0.8');
  expect(said).toContain('out-of-range');
  await lens.click();
  const peek = c.locator('.peekview-widget');
  await expect(peek).not.toContainText('Evidence summary');
  const files = (await groups(page)).join('\n');
  for (const rev of ['baseline', 'alice', 'loosened']) expect(files).toMatch(new RegExp(`revisions/${rev}/PrivateDocument\\.pkl`));
  // What the revision changed is among the locations: the type it loosened.
  const loosened = peek.getByRole('treeitem', { name: /revisions\/loosened\/PrivateDocument\.pkl/ }).first();
  if (await loosened.getAttribute('aria-expanded') !== 'true') await loosened.click();
  await expect(peek.getByRole('treeitem', { name: /this <= 0\.9/ })).toBeVisible();
});
