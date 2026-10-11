import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CIT-395: the frame for one Rails commit is computed by Frame.pkl from the
// case's evidence files; `cases/<hash>/frame.json` is that output, checked in
// for the story. These checks keep the fixture, the Vale alerts and the
// issue's acceptance check honest. UPDATE_FIXTURES=1 rewrites what drifted.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CASES = ['fddf74bea9'];
const has = (bin: string) => spawnSync(bin, ['--version']).status === 0;
const update = process.env.UPDATE_FIXTURES === '1';

describe.each(CASES)('rails claims: case %s', (hash) => {
  const dir = here(`cases/${hash}/`);

  it.skipIf(!has('vale'))('vale.json is what Vale reports on the commit message', () => {
    const raw = JSON.parse(
      // Vale exits 1 when it has alerts; that's the expected case here.
      spawnSync('vale', ['--output=JSON', `../cases/${hash}/commit.txt`], { cwd: here('vale/'), encoding: 'utf8' }).stdout,
    ) as Record<string, { Check: string; Line: number; Span: number[]; Match: string; Message: string }[]>;
    const alerts = Object.values(raw).flat().map(({ Check, Line, Span, Match, Message }) => ({ Check, Line, Span, Match, Message }));
    if (update) writeFileSync(dir + 'vale.json', JSON.stringify(alerts, null, 1) + '\n');
    expect(alerts).toEqual(JSON.parse(readFileSync(dir + 'vale.json', 'utf8')));
  });

  it.skipIf(!has('pkl'))('frame.json is what Frame.pkl computes from the evidence', () => {
    const frame = execFileSync('pkl', ['eval', '-f', 'json', '-p', `hash=${hash}`, here('Frame.pkl')], { encoding: 'utf8' });
    if (update) writeFileSync(dir + 'frame.json', frame);
    expect(JSON.parse(frame)).toEqual(JSON.parse(readFileSync(dir + 'frame.json', 'utf8')));
  });

  it.skipIf(!has('pkl'))("the issue's acceptance check: 3 facts pass, the recording and peek facts fail", () => {
    const run = spawnSync('pkl', ['test', 'sketch_test.pkl'], { cwd: dir, encoding: 'utf8' });
    const facts = [...run.stdout.matchAll(/^ {2}(\S.*?) (✅|❌)$/gm)].map(([, name, mark]) => [name, mark === '✅']);
    expect(Object.fromEntries(facts)).toEqual({
      'subject line is the real commit subject': true,
      'highlighted lines are the real sentence': true,
      'every highlight sits on a line containing the flagged word': true,
      'the score has a recording for its payload digest': false,
      'both peek states exist as snapshots': false,
    });
  });
});

it('the story restates no score: every value it shows comes from frame.json', () => {
  const story = readFileSync(here('../../stories/RailsClaims.stories.tsx'), 'utf8');
  expect(story).not.toMatch(/Jev \d/);
  expect(story).not.toMatch(/sha256:[0-9a-f]/);
});
