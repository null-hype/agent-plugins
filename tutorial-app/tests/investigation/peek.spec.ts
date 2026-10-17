import { expect, test } from '@playwright/test';

test('the pre-registered-question story completes, including Peek, on load and reload', async ({ page }) => {
  await page.goto('/?path=/story/investigations-pre-registered-question--agent-asked-two-more');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  const canvas = page.frameLocator('#storybook-preview-iframe');
  const playback = page.getByRole('toolbar', { name: 'Component test playback controls' });
  const assertCompleted = async () => {
    // storyFinished alone also fires when play throws. Require the Interactions
    // panel's actual pass status AND the user-visible result of that play.
    await expect(playback.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
    const peek = canvas.locator('.peekview-widget');
    await expect(peek).toContainText('Does the check fail when a read of the private file is forged?');
    await expect(peek).toContainText('Can the check tell a real block from a generic crash?');
    await expect(peek).toContainText('snapshot 32e5155e');
    await expect(peek).toContainText('evidence: Forging the read still left all 28 assertions passing.');
  };
  await assertCompleted();
  // Reloading reuses Monaco's CodeLens cache, whose labels initially have no
  // command. Ensure we observe the new mount rather than the previous pass.
  const previous = await canvas.locator('.peekview-widget').elementHandle();
  await page.getByRole('button', { name: 'Reload story', exact: true }).click();
  await expect.poll(() => previous!.evaluate(el => el.isConnected)).toBe(false);
  await assertCompleted();
});

test('slice 2 walks from the snapshot diff into the planted evidence', async ({ page }) => {
  await page.goto('/?path=/story/investigations-pre-registered-question--into-the-evidence');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.getByTestId('investigation-path')).toContainText('inputs/observations/forged-read.json');
  await expect(canvas.locator('.squiggly-warning').first()).toBeVisible();
  await expect(canvas.locator('.investigation-added').first()).toBeVisible();
  await canvas.getByRole('button', { name: '↑ vault' }).click();
  await expect(canvas.getByTestId('investigation-path')).toHaveText('investigations');
});

test('Autodocs mounts all vaults and routes definitions to their own editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?path=/docs/investigations-pre-registered-question--docs');
  const docs = page.frameLocator('#storybook-preview-iframe');
  const vaults = docs.getByTestId('investigation-vault');
  await expect(vaults).toHaveCount(9);
  for (let i = 0; i < 4; i++) {
    const vault = vaults.nth(i);
    await expect(vault.locator('.monaco-editor').first()).toBeVisible();
    await vault.getByRole('button', { name: /snapshots · Peek$/ }).click();
    const peek = vault.locator('.peekview-widget');
    await expect(peek).toContainText('A  inputs/observations/forged-read.json');
    await peek.locator('.monaco-editor textarea, .monaco-editor .native-edit-context').first().press('F12');
    await expect(vault.locator('..').getByTestId('investigation-path')).toContainText('inputs/observations/forged-read.json');
    await expect(peek).toHaveCount(0);
    await vault.getByRole('button', { name: '#120 ✓ failed' }).click();
    await expect(vault.locator('..').getByTestId('investigation-path')).toContainText('#120');
    if (i === 0) await expect(vaults.nth(1).locator('..').getByTestId('investigation-path')).toHaveText('investigations');
  }
  for (let i = 4; i < 6; i++) {
    const vault = vaults.nth(i);
    await vault.getByRole('button', { name: '3 findings · open the archive' }).click();
    await expect(vault.locator('..').getByTestId('investigation-path')).toContainText('release-2026-10.tar.gz');
    await vault.locator('.monaco-editor textarea, .monaco-editor .native-edit-context').first().press('F12');
    await expect(vault.locator('..').getByTestId('investigation-path')).toContainText('forged-read.json');
    await vault.getByRole('button', { name: '#120 ✓ failed' }).click();
    await expect(vault.locator('..').getByTestId('investigation-path')).toContainText('#120');
    await vault.locator('..').getByRole('button', { name: '↑ Drive' }).click();
    await expect(vault.locator('..').getByTestId('investigation-path')).toHaveText('Proton Drive  ›  investigations');
  }
  expect(errors).toEqual([]);
});

 test('revision verdict opens its deciding rule and Peeks at the preceding revision', async ({ page }) => {
  await page.goto('/?path=/story/investigations-pre-registered-question--verdict-across-revisions');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.getByTestId('investigation-path')).toContainText('#120');
  await expect(canvas.locator('.peekview-widget')).toContainText('#118/inputs');
  await expect(canvas.locator('.peekview-widget')).not.toContainText('trace.contains(');
});

test('Drive archive opens through the listing into its finding', async ({ page }) => {
  await page.goto('/?path=/story/investigations-pre-registered-question--archive-in-drive');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.getByTestId('investigation-path')).toContainText('release-2026-10.tar.gz');
  await expect(canvas.getByTestId('investigation-path')).toContainText('forged-read.json');
  await canvas.getByRole('button', { name: '↑ Drive' }).click();
  await expect(canvas.getByTestId('investigation-path')).toHaveText('Proton Drive  ›  investigations');
});

test('retained Drive listing renders the recorded snapshot without invented findings', async ({ page }) => {
  await page.goto('/?path=/story/investigations-pre-registered-question--real-drive-listing');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.getByTestId('investigation-path')).toContainText('restic-repo  ›  snapshots');
  await expect(canvas.locator('.view-lines')).toContainText('411 B');
  await expect(canvas.locator('.squiggly-warning')).toHaveCount(0);
  await expect(canvas.getByRole('button', { name: /findings · open the archive/ })).toHaveCount(0);
});

test('retained snapshot walk reaches hello.txt and returns through every parent', async ({ page }) => {
  await page.goto('/?path=/story/investigations-pre-registered-question--open-real-snapshot');
  await page.getByRole('tab', { name: /^Interactions/ }).click();
  await expect(page.locator('[aria-label="Story status: Pass"]')).toBeVisible({ timeout: 20_000 });
  const canvas = page.frameLocator('#storybook-preview-iframe');
  await expect(canvas.locator('.view-lines')).toContainText('47 B');
  for (const label of ['↑ snapshots', '↑ restic-repo', '↑ Drive']) {
    await canvas.getByRole('button', { name: label, exact: true }).click();
  }
  await expect(canvas.getByRole('button', { name: 'open restic-repo/', exact: true })).toBeVisible();
  await expect(canvas.getByTestId('investigation-path').getByRole('button')).toHaveCount(0);
});
