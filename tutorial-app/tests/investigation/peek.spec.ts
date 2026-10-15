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
    await expect(peek).toContainText('snapshot: 32e5155e');
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
