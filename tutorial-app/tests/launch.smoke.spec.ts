import { expect, test } from '@playwright/test';

const LANDING = '/part-0/overview/start';
const DEMO = '/part-5/can-an-upload-read-a-private-file/1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one';
const EVIDENCE = 'https://github.com/null-hype/agent-plugins/blob/main/docs/launch/claims-evidence.md';
const CONTACT = 'https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml';

test('logged-out journey: root → explanation → demo → evidence → contact', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`${LANDING}/?$`));
  await expect(page.getByText('What does the passing check actually tell you about the answer?', { exact: true })).toBeVisible();

  const email = page.getByRole('link', { name: 'public.rant@pm.me', exact: true });
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('href', 'mailto:public.rant@pm.me');
  await expect(page.getByRole('link', { name: 'Open an issue', exact: true })).toHaveAttribute('href', CONTACT);
  await page.getByRole('link', { name: /Start the review/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`${DEMO}/?$`));
  await expect(page.getByRole('heading', { name: 'Can the check tell a real read of the private file from a forged one?', exact: true })).toBeVisible();

  const evidence = page.locator('#gap-footer-band').getByRole('link', { name: 'Inspect the evidence', exact: true });
  await expect(evidence).toHaveAttribute('href', EVIDENCE);
  const [sourcePage] = await Promise.all([context.waitForEvent('page'), evidence.click()]);
  await sourcePage.waitForLoadState('domcontentloaded');
  await expect(sourcePage).toHaveURL(EVIDENCE);
  await expect(sourcePage.getByRole('heading', { name: 'Claim → executable evidence (CIT-162)', exact: true })).toBeVisible();

  const [contactPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#gap-footer-band').getByRole('link', { name: 'Contact', exact: true }).click(),
  ]);
  await contactPage.waitForLoadState('domcontentloaded');
  // GitHub requires an account to create an issue. The logged-out route must
  // reach its sign-in page and preserve the intended issue-form destination.
  await expect(contactPage).toHaveURL(/https:\/\/github\.com\/login\?/);
  const destination = new URL(new URL(contactPage.url()).searchParams.get('return_to')!, 'https://github.com');
  expect(destination.pathname).toBe('/null-hype/agent-plugins/issues/new');
  expect(destination.searchParams.get('template')).toBe('apply-this.yml');
  await expect(contactPage.getByRole('heading', { name: 'Sign in to GitHub' })).toBeVisible();
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
