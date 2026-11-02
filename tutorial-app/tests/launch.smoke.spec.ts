import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
        await expect(page.getByText('Unavailable for this rerun', { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Snapshot evidence ↗' })).toHaveCount(0);
      } else {
        await expect(page.getByRole('link', { name: 'Snapshot evidence ↗' })).toBeVisible();
      }
      await page.getByText('Run details', { exact: true }).click();
      await expect(page.getByText('fixture-delivery-1', { exact: true })).toBeVisible();
      await expect(page.locator('#xeno-status')).toHaveAttribute('data-status', red ? 'started' : 'completed');
      await expect(page.locator('#xeno-status').getByText(red ? 'In Review' : 'Done', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test('logged-out journey: professional homepage → proof, research and contact', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  // The 10-second test: who, what, credibility, evidence, contact.
  await expect(page.getByRole('heading', { level: 1, name: 'Richard Anthony', exact: true })).toBeVisible();
  await expect(page.getByText('Senior software & security engineer', { exact: true })).toBeVisible();
  await expect(page.getByText(/Sydney, Australia · Available for consulting and senior engineering roles/)).toBeVisible();
  for (const area of ['AI & agent infrastructure', 'Security & verification', 'Developer infrastructure']) {
    await expect(page.getByRole('heading', { level: 3, name: area, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Bloomberg', { exact: true })).toBeVisible();
  await expect(page.getByText('XO Group', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'LinkedIn ↗', exact: true }).first()).toHaveAttribute('href', 'https://www.linkedin.com/in/richardanthonydev/');
  await expect(page.getByRole('link', { name: 'GitHub ↗', exact: true }).first()).toHaveAttribute('href', 'https://github.com/null-hype');
  const discuss = page.getByRole('link', { name: 'Discuss a project', exact: true }).first();
  await expect(discuss).toBeVisible();
  await expect(discuss).toHaveAttribute('href', /^mailto:public\.rant@pm\.me\?subject=/);
  await expect(page.getByRole('link', { name: 'See selected work', exact: true })).toHaveAttribute('href', '#work');
  // Selected work links to source and the recorded review; no demo or tutorial runtime on the homepage.
  await expect(page.locator('.pro-project')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Source and runnable example ↗' }).first()).toHaveAttribute('href', 'https://github.com/null-hype/worlds');
  await expect(page.getByRole('button', { name: 'Evaluate integration' })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
  // The offer does not depend on project vocabulary in the first screen.
  const firstScreen = await page.locator('.pro-hero').innerText();
  for (const jargon of ['Worlds', 'Witness', 'JEV', 'Dagger', 'Pkl']) expect(firstScreen).not.toContain(jargon);
  // It fits a phone without horizontal scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Research keeps the interactive example. A repaired input invalidates the
  // prior result; passing never grants human approval.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Research', exact: true }).click();
  await expect(page).toHaveURL(/\/research\/?$/);
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

  // The tutorial routes still work from the research page.
  await page.getByRole('link', { name: 'Challenge a check', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${DEMO}/?$`));
  await expect(page.getByRole('heading', { name: 'Can the check tell a real read of the private file from a forged one?', exact: true })).toBeVisible();
  await expect(page.locator('#gap-footer-band').getByRole('link', { name: 'Inspect the evidence', exact: true })).toHaveAttribute('href', EVIDENCE);
  await expect(page.locator('#gap-footer-band').getByRole('link', { name: 'Contact', exact: true })).toHaveAttribute('href', CONTACT);
});
