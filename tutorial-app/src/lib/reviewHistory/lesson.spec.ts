import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPTURES, PATHS } from './index';

/**
 * CIT-306 (CIT-305 T11): the canary lesson stopped at the third round's
 * correction and said that, with it, a deleted or forged trace changes what is
 * computed. The final follow-up showed otherwise. These checks keep the page
 * corrected: they read the page as it is in the working tree and compare it
 * with the lesson bytes pinned in the evidence bundle.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const bundle = join(repoRoot, 'tutorial-app/evidence/cit-294-review-history-v1');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

const page = readFileSync(join(repoRoot, PATHS.lesson), 'utf8');
const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as { files: Array<{ state: string; path: string; file: string }> };
const pinnedLesson = (state: string) => {
  const entry = manifest.files.find((f) => f.state === state && f.path === PATHS.lesson);
  if (!entry) throw new Error(`no pinned lesson at ${state}`);
  return readFileSync(join(bundle, entry.file), 'utf8');
};
const capture = (key: keyof typeof CAPTURES) => readFileSync(join(bundle, 'captures', CAPTURES[key].file), 'utf8');

describe('the canary lesson page', () => {
  it('no longer says what it said at round three, which the pinned bytes show it said at both S3 and S4', () => {
    const roundThree = normalize(pinnedLesson('S3').split('\n').slice(44, 50).join('\n'));
    expect(roundThree).toContain('so a deleted or forged trace changes what gets computed');
    expect(normalize(pinnedLesson('S4'))).toContain(roundThree);
    expect(normalize(page)).not.toContain(roundThree);
    expect(normalize(page)).not.toContain('recorded transcript of one live execution');
  });

  it('carries the third review and the final follow-up the page used to omit', () => {
    const text = normalize(page);
    expect(text).toContain('three reviews');
    expect(text).toContain('**Round three**');
    expect(text).toContain('**The follow-up**');
    expect(text).toContain('29 facts / 75 asserts / 4 examples');
    expect(text).toContain('33 tests, 0 failures');
    expect(text).toContain('No review of this revision is recorded.');
    expect(text).toContain('`cc23e89`');
  });

  it('states the correction openly, and what remains unrecorded', () => {
    const text = normalize(page);
    expect(text).toContain('Correction to an earlier version of this page');
    expect(text).toContain('That overstated the fix');
    expect(text).toContain('second-hand account');
    expect(text).toContain('not retrievable');
    expect(text).toContain('is an empty list for every arm');
    expect(text).toContain('recorded review prose, not captured executions');
    expect(text).toContain('A static narration of a recorded history');
    expect(text).toContain('is not built yet');
  });

  it('quotes the original question and the PR claim verbatim, and labels the question as unsealed', () => {
    const text = normalize(page);
    for (const quote of ['Run one pinned Rails/libvips/libmatio/HDF5 configuration against three inputs/arms', 'A generic crash alone is insufficient.']) {
      expect(text).toContain(quote);
      expect(normalize(capture('q0Description'))).toContain(quote);
    }
    expect(text).toContain('**not a sealed declaration**');
    const claim = "is now caught; it wasn't before.";
    expect(text).toContain(claim);
    expect(normalize(capture('pr120'))).toContain(claim);
  });

  it('states the fact totals the bundle recounts and the report it cites', () => {
    const report = readFileSync(join(bundle, 'files', pinnedRevision('S4'), 'docs/investigations/CIT-265/cit-294/reports/cit294.test.xml'), 'utf8');
    expect(report).toContain('tests="33" failures="0"');
    expect(normalize(page)).toContain('8 facts passing');
  });

  it('stays a recorded, non-interactive page', () => {
    const frontmatter = page.split('---')[1];
    for (const flag of ['editor', 'terminal', 'previews']) expect(frontmatter).toMatch(new RegExp(`^${flag}: false$`, 'm'));
  });

  it('links only to repository paths that exist', () => {
    const links = [...page.matchAll(/https:\/\/github\.com\/null-hype\/agent-plugins\/(?:blob|tree)\/main\/([^)\s#]+)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const path of links) expect(existsSync(join(repoRoot, path)), path).toBe(true);
  });
});

function pinnedRevision(state: string): string {
  const entry = manifest.files.find((f) => f.state === state && f.path === PATHS.junitReport);
  if (!entry) throw new Error(`no pinned report at ${state}`);
  return entry.file.split('/')[1];
}
