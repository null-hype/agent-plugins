import { test, expect } from '@playwright/test';
import { openEvidence } from './follower-maze-helpers';

test('generated workbench supports direct entry, preview reload, Solve and Reset', async ({ page }) => {
 page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE:', message.text()); });
 page.on('requestfailed', (request) => console.log('FAILED:', request.url(), request.failure()?.errorText));
 page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
 await page.goto('/part-2/follower-maze-evidence/1-select-a-failing-run-and-open-its-evidence/');
 const app = page.frameLocator('#previews-container iframe');
 const log = app.frameLocator('iframe[title="otel-warm-log preview"]');
 await expect(app.getByTestId('counter-footer')).toContainText('4 pass · 12 missing · 4 forbidden · 4 both', { timeout: 120_000 });
 await expect(app.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'false');
 await app.getByTestId('chip-4231').click();
 await openEvidence(app);
 await page.getByRole('button', { name: 'Reload Preview', exact: true }).click();
 await expect(app.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'true');
 await expect(log.locator('.evidence-widget')).toContainText('-- missing --');
 await page.getByRole('button', { name: 'Reset interaction', exact: true }).click();
 await expect(app.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'false');
 await expect(log.locator('.evidence-widget')).toHaveCount(0);
 await page.getByRole('button', { name: 'Show completed interaction', exact: true }).click();
 await expect(app.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'true');
 await expect(log.locator('.evidence-widget')).toContainText('-- missing --');
 await page.reload();
 await expect(app.getByTestId('counter-footer')).toContainText('4 pass · 12 missing · 4 forbidden · 4 both', { timeout: 120_000 });
 await expect(app.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'false');
 await expect(log.locator('.evidence-widget')).toHaveCount(0);
});
