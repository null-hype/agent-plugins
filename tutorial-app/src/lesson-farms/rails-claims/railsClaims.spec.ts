import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// CIT-395: every value the story shows comes from frame.json. Re-recording the
// evidence (Vale, Frame.pkl, the browser) and running the case's facts is the
// Dagger check (`dagger call rails-claim --hash <hash> check`, CIT-397), not
// this spec.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

it('the story restates no score: every value it shows comes from frame.json', () => {
  const story = readFileSync(here('../../stories/RailsClaims.stories.tsx'), 'utf8');
  expect(story).not.toMatch(/Jev \d/);
  expect(story).not.toMatch(/sha256:[0-9a-f]/);
});
