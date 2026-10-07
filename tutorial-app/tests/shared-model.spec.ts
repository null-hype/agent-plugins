import { expect, test, type Page } from '@playwright/test';

// Two people review one shared Pkl model, each in their own browser. The
// model's types say what a sound answer is; an edit that breaks one is
// rejected by Pkl itself, and that rejection is the diagnostic.
const story = (user: string) => `/iframe.html?id=shared-model--private-document&viewMode=story&args=user:${user}`;
const client = (page: Page) => page.frameLocator('iframe[title="acp-trace client preview"]');

test.beforeEach(async ({ request }) => {
  await request.post('/__shared-model/reset');
});

test("Alice's edit that breaks the model's type comes back as Pkl's own diagnostic", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await alice.goto(story('alice'));
  const c = client(alice);
  await expect(c.locator('.ghost-text-decoration').first()).toContainText("Can Alice read Bob's private document?");
  await c.getByRole('textbox', { name: 'Editor content', exact: true }).press('Tab');

  // As committed, the model evaluates: Alice's chance is within its type.
  const lens = c.getByRole('button', { name: /pkl\./ });
  await expect(lens).toContainText('pkl.evaluated');
  await lens.click();
  const peek = c.locator('.peekview-widget');
  await expect(peek).toBeVisible();

  // Her working copy opens editable in the Peek; she raises Alice's chance and saves.
  const editor = peek.locator('.monaco-editor').first();
  await editor.evaluate((element) => {
    const monaco = (element.ownerDocument.defaultView as any).monaco;
    const e = monaco.editor.getEditors().find((x: any) => x.getDomNode() === element);
    const model = e.getModel();
    const match = model.findMatches('aliceReads: NotOwner = ', false, false, true, null, false)[0];
    const line = match.range.startLineNumber;
    e.focus();
    e.setSelection(new monaco.Range(line, match.range.endColumn, line, model.getLineMaxColumn(line)));
  });
  await alice.keyboard.type('0.8');
  await alice.keyboard.press('Control+s');

  // Pkl rejects it, and says where: the constraint and the value that broke it.
  await expect(lens).toContainText('pkl.constraint');
  await expect(lens).toContainText('3 related');
  const marker = await c.locator('body').evaluate((el) => {
    const monaco = (el.ownerDocument.defaultView as any).monaco;
    return monaco.editor.getModelMarkers({}).map((m: any) => m.message).join('\n');
  });
  expect(marker).toContain('Type constraint `this <= 0.5` violated.');
  expect(marker).toContain('Value: 0.8');

  // The Peek she saved from lists what it was opened on; the new finding's lens
  // opens the locations Pkl named.
  await alice.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  await lens.click();
  // Two versions of the model: the base she started from (the value it held),
  // then her working copy (the constraint and her value).
  await expect(peek.locator('[aria-level="1"]')).toHaveCount(2);
  const files = await peek.locator('[aria-level="1"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(files[0]).toMatch(/PrivateDocument\.pkl@base/);
  expect(files[1]).toMatch(/alice\/PrivateDocument\.pkl/);
});
