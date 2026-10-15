import { describe, expect, it } from 'vitest';
import listing from '../stories/fixtures/protondrive/list-json-restic-snapshots.json';
import { driveEntries, formatSize, type ProtonDriveNode } from './protonDriveListing';

const nodes = listing as ProtonDriveNode[];
const [snapshot] = nodes;

describe('driveEntries', () => {
  it("reads CIT-378's real listing of restic-repo/snapshots", () => {
    expect(driveEntries(nodes)).toEqual([{
      uid: 'VOLUME_ID~SNAPSHOT_FILE_NODE_ID',
      name: '14e7ff8f01d99fe15b42792b859359dcf983f3a856c536dfc4e2ac22375f9488',
      type: 'file',
      size: 411,
      modified: '2026-10-09T20:23:05.000Z',
    }]);
  });

  it("falls back to the uid when the name couldn't be decrypted", () => {
    const [entry] = driveEntries([{ ...snapshot, name: { ok: false, error: 'decryption failed' } }]);
    expect(entry.name).toBe(snapshot.uid);
  });

  it('has no size for a folder, which has no active revision', () => {
    const folder: ProtonDriveNode = {
      uid: 'VOLUME_ID~SNAPSHOTS_FOLDER_NODE_ID',
      name: { ok: true, value: 'snapshots' },
      type: 'folder',
      modificationTime: '2026-10-09T20:23:05.000Z',
    };
    expect(driveEntries([folder])).toEqual([{ uid: folder.uid, name: 'snapshots', type: 'folder', size: undefined, modified: folder.modificationTime }]);
  });
});

describe('formatSize', () => {
  it('shows bytes as the CLI claimed them, and larger sizes in KB', () => {
    expect(formatSize(411)).toBe('411 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
  });
});
