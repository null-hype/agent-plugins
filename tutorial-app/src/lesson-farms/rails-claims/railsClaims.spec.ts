import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// CIT-395: every value the story shows comes from frame.json. The case's
// facts run in the Dagger check (`dagger check check-rails-claims`, CIT-397),
// not this spec.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

it('the story restates no score: every value it shows comes from frame.json', () => {
  const story = readFileSync(here('../../stories/RailsClaims.stories.tsx'), 'utf8');
  expect(story).not.toMatch(/Jev \d/);
  expect(story).not.toMatch(/sha256:[0-9a-f]/);
});
