import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  loadResticEvidence,
  type ResticLessonEvidence,
  type ModelledSnapshot,
  type ModelledDiff,
  type FileDump,
  type SnapshotRef,
  type DiffEntry,
  type FileTreeEntry,
} from './index';

// A consumer must load committed values, never the generated evaluator or a CLI.
vi.mock('@pkl-community/pkl-typescript', () => {
  throw new Error('The evidence loader must not import the Pkl evaluator');
});
vi.mock('node:child_process', () => {
  const forbidden = () => { throw new Error('No subprocess may load evidence'); };
  return {
    exec: forbidden, execSync: forbidden,
    execFile: forbidden, execFileSync: forbidden,
    spawn: forbidden, spawnSync: forbidden, fork: forbidden,
  };
});

describe('modelled restic evidence consumer', () => {
  it('imports typed snapshots, the S1 → S2 diff and file dumps without Pkl', () => {
    const model = loadResticEvidence();
    expectTypeOf(model).toEqualTypeOf<ResticLessonEvidence>();
    expectTypeOf(model.snapshots).toEqualTypeOf<ModelledSnapshot[]>();
    expectTypeOf(model.diff).toEqualTypeOf<ModelledDiff[]>();
    expectTypeOf(model.dumps).toEqualTypeOf<FileDump[]>();
    expectTypeOf(model.snapshots[0].value).toEqualTypeOf<SnapshotRef>();
    expectTypeOf(model.diff[0].value).toEqualTypeOf<DiffEntry>();
    expectTypeOf(model.dumps[0].entry).toEqualTypeOf<FileTreeEntry>();
    expectTypeOf(model.provenance).toEqualTypeOf<'modelled'>();
    expectTypeOf(model.diff[0].value.changeType).toEqualTypeOf<'added' | 'removed' | 'modified'>();

    const [s1, s2] = model.snapshots;
    expect(model.snapshots.map((s) => [s.state, s.value.shortId])).toEqual([
      ['S1', '32e5155e'], ['S2', '3c0f3a7e'],
    ]);
    expect(model.diff).toHaveLength(24);
    expect(model.dumps).toHaveLength(47);
    for (const claim of [model, ...model.snapshots, ...model.diff, ...model.dumps]) {
      expect(claim.provenance).toBe('modelled');
    }
    for (const { value } of model.diff) {
      expect(value.fromSnapshotId).toBe(s1.value.id);
      expect(value.toSnapshotId).toBe(s2.value.id);
    }
    expect(model.diff.find((d) => d.value.path === '/bundle/inputs/canary-reads.txt')?.value.changeType)
      .toBe('modified');
    expect(model.diff.find((d) => d.value.path === '/bundle/inputs/reports/diagnostics.json')?.value.changeType)
      .toBe('added');

    for (const snapshot of model.snapshots) {
      const dump = (path: string) => model.dumps.find((d) =>
        d.entry.snapshotId === snapshot.value.id && d.entry.path === path);
      expect(dump('/bundle/inputs/canary-reads.txt')?.contents).toContain('/work/dummy-canary.txt');
      const result = dump('/bundle/runs/deleted-trace/result.txt');
      expect(result?.contents).toContain('100.0%');
      const answer = dump('/bundle/runs/deleted-trace/answer.json');
      expect(answer).toBeDefined();
      expect(JSON.parse(answer!.contents)).toMatchObject({
        exitCode: 0,
        assertsTotal: snapshot.state === 'S1' ? 28 : 56,
      });
    }
    for (const dump of model.dumps) {
      expect(new TextEncoder().encode(dump.contents).byteLength).toBe(dump.entry.size);
      expect(model.snapshots.some((s) => s.value.id === dump.entry.snapshotId)).toBe(true);
    }
  });

  it('isolates consumers from edits to a previously loaded model', () => {
    const first = loadResticEvidence();
    first.snapshots[0].value.id = 'changed by a story';
    first.diff.splice(0);
    first.dumps[0].contents = 'changed';
    const next = loadResticEvidence();
    expect(next.snapshots[0].value.shortId).toBe(next.snapshots[0].value.id.slice(0, 8));
    expect(next.diff).toHaveLength(24);
    expect(next.dumps[0].contents).not.toBe('changed');
  });
});
