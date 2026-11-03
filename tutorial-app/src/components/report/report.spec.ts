import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Report.pkl is the one definition of the homepage report. Pkl is required, not
// skipped: a skipped drift check would pass on exactly the machines that cannot
// see drift.
describe('the homepage report', () => {
  it('is what Report.pkl renders, as committed in report.json', () => {
    const rendered = execFileSync('pkl', ['eval', here('./Report.pkl')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(readFileSync(here('./report.json'), 'utf8')).toBe(rendered);
  });
});
