import { expect, test } from '@playwright/test';

// Assertions and interactions live in each story's shared play function.
// This runner only makes their success a gate in the existing replay CI target.
const stories = [
  'lessons-private-file--pr-117',
  'lessons-private-file--pr-118',
  'lessons-private-file--pr-120',
  'lessons-private-file--cc-23-e-89',
];

test('all private-file Storybook interactions pass', async ({ page }) => {
  for (const storyId of stories) {
    await test.step(storyId, async () => {
      await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
      await expect.poll(() => page.evaluate(() => {
        const channel = (window as any).__STORYBOOK_ADDONS_CHANNEL__;
        return channel?.last('storyFinished')?.[0];
      })).toMatchObject({ storyId, status: 'success' });
    });
  }
});
