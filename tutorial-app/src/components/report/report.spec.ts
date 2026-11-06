import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const pkl = (...args: string[]) => execFileSync('pkl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: here('.') });

// Home.pkl is the one definition of the homepage report, scored by Report.pkl.
// Pkl is required, not skipped: a skipped drift check would pass on exactly the
// machines that cannot see drift.
describe('the homepage report', () => {
  it('is what Home.pkl renders, as committed in report.json', () => {
    expect(readFileSync(here('./report.json'), 'utf8')).toBe(pkl('eval', here('./Home.pkl')));
  });

  it('is scored by a Report.pkl that passes its own tests', () => {
    expect(pkl('test', here('./Report.test.pkl'))).toContain('100.0% tests pass');
  });
});

// Each article's page is built from the JSON its Pkl source renders.
describe('the articles', () => {
  for (const name of ['Xeno', 'Omarchy']) {
    it(`${name} is what ${name}.pkl renders, as committed`, () => {
      expect(readFileSync(here(`./articles/${name.toLowerCase()}.json`), 'utf8')).toBe(pkl('eval', here(`./articles/${name}.pkl`)));
    });
  }
});

// A thread's Delta records are what its Pkl renders: the ghost written ahead
// of a run, and a trace sink session read by Sink.pkl.
describe('the threads', () => {
  it('the ghost is what ghost.pkl renders, as committed', () => {
    expect(readFileSync(here('./threads/ghost.jsonl'), 'utf8')).toBe(pkl('eval', here('./threads/ghost.pkl')));
  });

  it('are read by a Thread.pkl and Sink.pkl that pass their own tests', () => {
    expect(pkl('test', here('./threads/Threads.test.pkl'))).toContain('100.0% tests pass');
  });
});
