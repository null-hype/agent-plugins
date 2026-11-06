import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const LANDING = '/part-0/overview/start';

test.describe('Static claim reports', () => {
  test.use({ javaScriptEnabled: false });
  for (const red of [false, true]) {
    test(`the ${red ? 'red' : 'green'} report works without JavaScript`, async ({ page, baseURL }) => {
      // Fixtures are rendered by the actual publisher into CI's local build,
      // never shipped as public demo routes or mistaken for a live R2 proof.
      test.skip(!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Local rendered fixture only');
      await page.goto(red ? '/red-claim-fixture.html' : '/claim-fixture.html');
      await expect(page.getByRole('heading', { level: 1, name: 'A completed claim fixture' })).toBeVisible();
      await expect(page.getByText(red ? 'Failed' : 'Passed', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Trace ↗' })).toHaveAttribute('href', 'https://dagger.cloud/example/traces/fixture');
      await expect(page.getByRole('link', { name: 'Richard Anthony' })).toHaveAttribute('href', 'https://www.tidelands.dev/');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test('homepage is the name hero, the intro and checks from Home.pkl, and contact', async ({ page }) => {
  const report = JSON.parse(await readFile(fileURLToPath(new URL('../src/components/report/report.json', import.meta.url)), 'utf8'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Richard Anthony', exact: true })).toBeVisible();
  for (const text of report.intro) await expect(page.getByRole('main').getByText(text, { exact: true })).toBeVisible();
  for (const p of report.paragraphs) if (p.why) await expect(page.getByRole('main').getByText(p.why, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'richard@tidelands.dev', exact: true })).toHaveAttribute('href', 'mailto:richard@tidelands.dev');
  await expect(page.getByRole('link', { name: 'LinkedIn', exact: true })).toHaveAttribute('href', 'https://www.linkedin.com/in/richardanthonydev/');
  await expect(page.getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('heading', { level: 2, name: 'Checks', exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('each check on the homepage opens its claim page on the same deploy, and comes back', async ({ page, baseURL }) => {
  const report = JSON.parse(await readFile(fileURLToPath(new URL('../src/components/report/report.json', import.meta.url)), 'utf8'));
  for (const p of report.paragraphs) {
    const claim = JSON.parse(await readFile(fileURLToPath(new URL(`../src/components/report/checks/${p.id}.json`, import.meta.url)), 'utf8'));
    await page.goto('/');
    await page.getByRole('link', { name: p.text, exact: true }).click();
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    await expect(page.getByRole('heading', { level: 1, name: claim.issue.title, exact: true })).toBeVisible();
    if (p.why) await expect(page.getByText(p.why, { exact: true })).toBeVisible();
    if (p.prediction !== undefined) await expect(page.locator('.td-claim-prediction')).toContainText('Predicted');
    await expect(page.getByText(claim.exit === 0 ? 'Passed' : 'Failed', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Trace ↗' })).toHaveAttribute('href', claim.trace);
    await page.getByRole('link', { name: 'Richard Anthony', exact: true }).click();
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('rendered metadata points to a canonical page and loadable preview assets', async ({ page }) => {
  await page.goto(LANDING);
  const pathname = new URL(page.url()).pathname;
  const canonical = page.locator('link[rel="canonical"]');
  await expect(canonical).toHaveCount(1);
  expect(new URL((await canonical.getAttribute('href'))!).pathname.replace(/\/$/, '')).toBe(pathname.replace(/\/$/, ''));
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', (await canonical.getAttribute('href'))!);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  for (const key of ['twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) {
    await expect(page.locator(`meta[name="${key}"]`)).toHaveAttribute('content', /.+/);
  }
  const preview = (await page.locator('meta[property="og:image"]').getAttribute('content'))!;
  expect(new URL(preview).protocol).toBe('https:');
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', preview);
  // On PR builds the canonical host is production; request the same asset
  // path on the tested deployment so missing new files cannot be hidden.
  const imageResponse = await page.request.get(new URL(new URL(preview).pathname, page.url()).href);
  expect(imageResponse.ok()).toBe(true);
  expect(imageResponse.headers()['content-type']).toContain('image/png');
  const favicon = (await page.locator('link[rel="icon"]').getAttribute('href'))!;
  const faviconResponse = await page.request.get(new URL(favicon, page.url()).href);
  expect(faviconResponse.ok()).toBe(true);
  expect(faviconResponse.headers()['content-type']).toContain('image/svg+xml');
});

// Test the real exported Go HTML using local bytes at the pinned CDN URLs.
// Manual Storybook review separately checks the real CDN load.
test.describe('Published preregistration', () => {
  test.beforeEach(async ({ baseURL }) => {
    test.skip(!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Local rendered fixture only');
  });
  test('desktop markers and phone inline findings agree', async ({ page, isMobile }) => {
    const requests: string[] = [];
    await page.route('https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/**', async route => {
      const suffix = new URL(route.request().url()).pathname.split('/min/')[1];
      requests.push(suffix);
      const file = fileURLToPath(new URL('../node_modules/monaco-editor/min/' + suffix, import.meta.url));
      await route.fulfill({ body: await readFile(file), contentType: suffix.endsWith('.css') ? 'text/css' : 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/preregistration-claim-fixture.html');
    if (isMobile) {
      await expect(page.getByText(/Observed \+0.24/)).toBeVisible();
      await expect(page.locator('.td-prediction-line[data-highlighted="true"]')).toHaveCount(1);
      await expect(page.locator('.monaco-editor')).toHaveCount(0);
      expect(requests).toHaveLength(0);
    } else {
      await expect(page.locator('.monaco-editor')).toBeVisible();
      await expect(page.locator('.squiggly-warning')).toBeVisible();
      const markers = await page.evaluate(() => (window as any).monaco.editor.getModelMarkers({ owner: 'witness' }));
      expect(markers).toEqual([expect.objectContaining({ startLineNumber: 6, startColumn: 5, source: 'witness', message: expect.stringContaining('Observed +0.24') })]);
      const before = await page.evaluate(() => (window as any).monaco.editor.getModels()[0].getValue());
      await page.locator('.monaco-editor').click();
      await page.keyboard.type('must not edit');
      expect(await page.evaluate(() => (window as any).monaco.editor.getModels()[0].getValue())).toBe(before);
      await page.keyboard.press('F8');
      await expect(page.locator('.marker-widget')).toContainText('Observed +0.24');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('CDN failure retains source and findings', async ({ page, isMobile }) => {
    await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
    await page.goto('/preregistration-claim-fixture.html');
    await expect(page.getByText(/Observed \+0.24/)).toBeVisible();
    if (!isMobile) await expect(page.getByText('Editor unavailable. Source and findings are shown below.')).toBeVisible();
  });
  test('source and findings remain usable without JavaScript', async ({ browser, baseURL, isMobile }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: isMobile ? 393 : 1280, height: 850 } });
    const page = await context.newPage();
    await page.goto(baseURL + '/preregistration-claim-fixture.html');
    await expect(page.getByText(/Observed \+0.24/)).toBeVisible();
    await expect(page.getByText('prediction = 0.0', { exact: true })).toBeVisible();
    await context.close();
  });
});
