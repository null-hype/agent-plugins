import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeObsoleteLessons } from '../../tests/rails-probes/generate';

// CIT-362: a pull that renames a lesson moves its committed files and leaves the
// generated ones in the old directory; generating again must not keep it.
describe('removeObsoleteLessons', () => {
  let chapter = '';
  const put = (file: string) => {
    mkdirSync(path.dirname(path.join(chapter, file)), { recursive: true });
    writeFileSync(path.join(chapter, file), '{}');
  };
  afterEach(() => rmSync(chapter, { recursive: true, force: true }));

  it('removes a renamed lesson that holds only generated files, and keeps declared ones', () => {
    chapter = mkdtempSync(path.join(tmpdir(), 'cit-362-'));
    put('2-old-title/_files/acp-trace.json');
    put('2-old-title/_solution/acp-trace.json');
    put('2-old-title/_solution/reproduction/S2/probes/deleted-trace/result.txt');
    put('2-old-title/_solution/reproduction/S1/runs/baseline/canary-reads.txt');
    put('3-new-title/content.mdx');
    put('meta.md');
    removeObsoleteLessons(chapter, ['3-new-title']);
    expect(readdirSync(chapter).sort()).toEqual(['3-new-title', 'meta.md']);
  });

  it('refuses a directory with anything the replay did not generate', () => {
    chapter = mkdtempSync(path.join(tmpdir(), 'cit-362-'));
    put('2-old-title/_solution/acp-trace.json');
    put('2-old-title/content.mdx');
    expect(() => removeObsoleteLessons(chapter, [])).toThrow(/content\.mdx/);
    expect(readdirSync(chapter)).toEqual(['2-old-title']);
  });
});
