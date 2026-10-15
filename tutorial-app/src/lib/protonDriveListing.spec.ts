import { describe, expect, it } from 'vitest';
import listing from '../stories/fixtures/protondrive/list-json-restic-snapshots.json';
import runFolderListing from '../stories/fixtures/protondrive/list-json-run-folder.json';
import repoListing from '../stories/fixtures/protondrive/list-json-restic-repo.json';
import downloadTree from '../stories/fixtures/protondrive/download-tree.txt?raw';
import { describeEntry, downloadedNames, driveEntries, formatSize, type ProtonDriveNode } from './protonDriveListing';

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

describe("CIT-378's second run: the folder levels", () => {
  it('lists the run folder: its restic repository, a folder with no size', () => {
    expect(driveEntries(runFolderListing as ProtonDriveNode[])).toEqual([
      { uid: 'VOLUME_ID~RESTIC_REPO_NODE_ID', name: 'restic-repo', type: 'folder', size: undefined, modified: '2026-10-09T22:05:17.000Z' },
    ]);
  });

  it('lists restic-repo in CLI order: five folders without activeRevision, and config', () => {
    const entries = driveEntries(repoListing as ProtonDriveNode[]);
    expect(entries.map((e) => e.name)).toEqual(['index', 'snapshots', 'data', 'keys', 'config', 'locks']);
    expect(entries.filter((e) => e.type === 'folder').every((e) => e.size === undefined)).toBe(true);
    expect((repoListing as ProtonDriveNode[]).filter((n) => n.type === 'folder').every((n) => n.folder?.isImported === false && !n.activeRevision)).toBe(true);
    expect(entries.find((e) => e.name === 'config')).toMatchObject({ type: 'file', size: 155 });
  });

  it('describes an entry by its size, or as a folder, and its modification time', () => {
    const [index, , , , config] = driveEntries(repoListing as ProtonDriveNode[]);
    expect(describeEntry(config)).toBe('155 B · 2026-10-09 22:05 UTC');
    expect(describeEntry(index)).toBe('folder · 2026-10-09 22:05 UTC');
  });

  it("names what the download put in a folder; the empty locks/ isn't recreated", () => {
    expect(downloadedNames(downloadTree, 'restic-repo/snapshots')).toEqual(['b23bf5a1672f8c132a355b54b17ffd9ca58d717048f38a51c527d595ec378950']);
    expect(downloadedNames(downloadTree, 'restic-repo')).toEqual(['config', 'data', 'index', 'keys', 'snapshots']);
    expect(downloadedNames(downloadTree, 'restic-repo/locks')).toEqual([]);
  });
});
