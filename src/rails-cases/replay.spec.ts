import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// CIT-401: the user's steps through one story, opened alone (viewMode=story,
// embed=true, so its play function does not run). Recorded against
// STORYBOOK_URL, replayed from REPLAY_HAR with nothing else on the network.
const { REPLAY_HAR: har, REPLAY_STORY: story, REPLAY_WORD: word, REPLAY_PHRASE: phrase } = process.env;
const live = !!process.env.STORYBOOK_URL;
// The HAR matches on the exact URL, so both modes use one origin.
const origin = 'http://storybook:6006';

test(`${story}: follow the ${word} lens and back`, async ({ context, page }) => {
  if (!live) await context.route('**/*', route => route.abort());
  await context.routeFromHAR(har!, { url: `${origin}/**`, update: live, notFound: 'abort' });
  const frames: { action: string; snapshot: string }[] = [];
  const capture = async (action: string) => {
    frames.push({ action, snapshot: await page.locator('body').ariaSnapshot({ mode: 'ai' }) });
  };
  const url = `${origin}/iframe.html?id=investigations-rails-commit-claims--${story}&viewMode=story&embed=true`;
  await page.goto(url);
  const lenses = page.getByRole('button', { name: /Jev/ });
  await expect(lenses.first()).toBeVisible();
  await capture(`goto ${url}`);

  // Point at the flagged word on the line the phrase picks out.
  const line = page.locator('.view-line', { hasText: phrase! });
  const position = await line.evaluate((el, word) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode()); ) {
      const i = n.textContent!.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length);
      const w = r.getBoundingClientRect(), l = el.getBoundingClientRect();
      return { x: w.x - l.x + w.width / 2, y: w.y - l.y + w.height / 2 };
    }
    throw new Error(`no ${word} on the line`);
  }, word!);
  await line.hover({ position });
  await expect(page.getByRole('tooltip')).toBeVisible();
  await capture(`hover ${word}`);

  await page.getByRole('button', { name: new RegExp(`${word} · Jev`) }).click();
  await expect(page.getByText('pinned before the call', { exact: false })).toBeVisible();
  await capture(`click ${word} · Jev`);

  await page.getByRole('button', { name: '↑ COMMIT_EDITMSG' }).click();
  await expect(lenses.first()).toBeVisible();
  await capture('click ↑ COMMIT_EDITMSG');
  await writeFile(join(dirname(har!), 'keyframes.json'), JSON.stringify(frames, null, 2) + '\n');
});
