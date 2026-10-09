import { describe, expect, it } from 'vitest';
import snapshots from '../stories/fixtures/protondrive/restic-snapshots.json';
import ls from '../stories/fixtures/protondrive/restic-ls.ndjson?raw';
import { formatTime, parseResticLs, type ResticSnapshot } from './resticListing';

const snapshotId = 'b23bf5a1672f8c132a355b54b17ffd9ca58d717048f38a51c527d595ec378950';

describe('restic snapshots --json', () => {
  it("lists CIT-378's one snapshot, tagged with the run", () => {
    const [only, ...rest] = snapshots as ResticSnapshot[];
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id: snapshotId, short_id: 'b23bf5a1', paths: ['/tmp/tmp.XSDJnYLG2i'], tags: ['protondrive-scenario-20261009T220221Z-0b0d2885'] });
    expect(formatTime(only.time)).toBe('2026-10-09 22:05 UTC');
  });
});

describe('restic ls --json', () => {
  const { snapshot, nodes } = parseResticLs(ls);

  it('reads the snapshot from the first line: the same one restic snapshots lists', () => {
    expect(snapshot.id).toBe(snapshotId);
    expect(snapshot.tree).toBe((snapshots as ResticSnapshot[])[0].tree);
  });

  it('reads one node per line after it, down to hello.txt', () => {
    expect(nodes.map((n) => [n.type, n.path])).toEqual([
      ['dir', '/tmp'],
      ['dir', '/tmp/tmp.XSDJnYLG2i'],
      ['file', '/tmp/tmp.XSDJnYLG2i/hello.txt'],
    ]);
    expect(nodes[2]).toMatchObject({ name: 'hello.txt', size: 47, permissions: '-rw-r--r--' });
  });

  it("refuses output whose first line isn't the snapshot", () => {
    const [, ...nodeLines] = ls.trim().split('\n');
    expect(() => parseResticLs(nodeLines.join('\n'))).toThrow('the first line is not the snapshot');
  });
});
