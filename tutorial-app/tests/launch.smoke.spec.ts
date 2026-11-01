import { expect, test } from '@playwright/test';

const LANDING = '/part-0/overview/start';
const DEMO = '/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one';
const EVIDENCE = 'https://github.com/null-hype/agent-plugins/blob/main/docs/launch/claims-evidence.md';
const CONTACT = 'https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml';

test.describe('Static claim reports', () => {
  test.use({ javaScriptEnabled: false });
  for (const red of [false, true]) {
    test(`the ${red ? 'red' : 'green'} report works without JavaScript`, async ({ page, baseURL }) => {
      // Fixtures are rendered by the actual publisher into CI's local build,
      // never shipped as public demo routes or mistaken for a live R2 proof.
      test.skip(!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Local rendered fixture only');
      await page.goto(red ? '/red-claim-fixture.html' : '/claim-fixture.html');
      await expect(page.getByRole('heading', { level: 1, name: 'A completed claim fixture' })).toBeVisible();
      await expect(page.getByText(red ? 'Red · Failed' : 'Green · Passed', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open trace ↗' })).toHaveAttribute('href', 'https://dagger.cloud/example/traces/fixture');
      await expect(page.getByText(/Anyone with this link can view it/)).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      if (red) {
        await expect(page.getByText('Unavailable for this rerun')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Snapshot evidence ↗' })).toHaveCount(0);
      } else {
        await expect(page.getByRole('link', { name: 'Snapshot evidence ↗' })).toBeVisible();
      }
      await page.getByText('Run details', { exact: true }).click();
      await expect(page.getByText('fixture-delivery-1', { exact: true })).toBeVisible();
      await expect(page.getByText('Not evaluated', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test('logged-out journey: professional overview → proof, contact and demonstration', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'A green check should lead to evidence you can inspect.' })).toBeVisible();
  await expect(page.getByText('Richard Anthony · Software engineer · Sydney', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inspect the Worlds proof ↗', exact: true })).toHaveAttribute('href', 'https://github.com/null-hype/worlds#start-here-one-exact-world-proof');
  const email = page.getByRole('link', { name: 'public.rant@pm.me', exact: true });
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('href', 'mailto:public.rant@pm.me');
  await expect(page.getByRole('link', { name: 'Witness ↗', exact: true })).toHaveAttribute('href', 'https://github.com/null-hype/witness');
  // The explanation should fit a phone without horizontal scrolling or a tutorial runtime.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(0);
  // Exercise the same example visitors can now use on the homepage. A repaired
  // input invalidates the prior result; passing never grants human approval.
  await page.getByRole('button', { name: 'Evaluate integration', exact: true }).click();
  await expect(page.getByText('Failed', { selector: '.ic-failed' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect disagreement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Governing rule', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Apply repair (revises candidate B)', exact: true }).click();
  await expect(page.getByText('Stale: inputs changed')).toBeVisible();
  await page.getByRole('button', { name: 'Re-evaluate integration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve landing (simulated)', exact: true })).toBeVisible();
  await expect(page.getByText('Not approved', { exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
  await page.getByRole('link', { name: 'Challenge a check →', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${DEMO}/?$`));
  await expect(page.getByRole('heading', { name: 'Can the check tell a real read of the private file from a forged one?', exact: true })).toBeVisible();
  await expect(page.locator('#gap-footer-band').getByRole('link', { name: 'Inspect the evidence', exact: true })).toHaveAttribute('href', EVIDENCE);
  await expect(page.locator('#gap-footer-band').getByRole('link', { name: 'Contact', exact: true })).toHaveAttribute('href', CONTACT);
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
