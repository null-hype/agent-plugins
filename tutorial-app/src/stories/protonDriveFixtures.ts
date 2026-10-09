import { describeEntry, downloadedNames, driveEntries, type ProtonDriveNode } from '../lib/protonDriveListing';
import { formatTime, parseResticLs, type ResticSnapshot } from '../lib/resticListing';
import type { DriveFolder, Investigation } from '../lib/investigationModel';
import { inDrive } from './investigationFixtures';
import snapshotsListing from './fixtures/protondrive/list-json-restic-snapshots.json';
import runFolderListing from './fixtures/protondrive/list-json-run-folder.json';
import repoListing from './fixtures/protondrive/list-json-restic-repo.json';
import resticSnapshots from './fixtures/protondrive/restic-snapshots.json';
import downloadTree from './fixtures/protondrive/download-tree.txt?raw';
import resticLs from './fixtures/protondrive/restic-ls.ndjson?raw';

// The Drive pane from CIT-378's real listings (fixtures/protondrive/README.md
// says where each comes from). No agent has asked anything of these
// repositories, so the panes have no findings.

/** CIT-386: the first run's `restic-repo/snapshots`, one real snapshot file. */
export const snapshotsFolder = 'my-files/protondrive-scenario-20261009T202201Z-4de6cd3f/restic-repo/snapshots';
export const [realSnapshot] = driveEntries(snapshotsListing as ProtonDriveNode[]);
export const fromListing: Investigation = {
  drive: {
    folder: snapshotsFolder,
    // A restic snapshot file is named by its snapshot ID, so the pane doesn't repeat it.
    archives: driveEntries(snapshotsListing as ProtonDriveNode[]).map((e) => ({ name: e.name, snapshot: e.name.slice(0, 8), detail: describeEntry(e) })),
  },
  vault: 'investigations',
  question: inDrive.question,
  agent: [],
};

/** CIT-388: the second run, from its folder down to the file restic backed up. */
export const runId = 'protondrive-scenario-20261009T220221Z-0b0d2885';
export const runFolder = `my-files/${runId}`;
export const ls = parseResticLs(resticLs);
const [snapshot] = resticSnapshots as ResticSnapshot[];
const hello = ls.nodes.find((n) => n.name === 'hello.txt')!;
// Not captured: headless-round-trip.sh writes `echo "$RUN_ID" > hello.txt`, and
// the run ID is the snapshot's tag. The vitest checks it's the 47 bytes restic lists.
export const helloContents = `${ls.snapshot.tags![0]}\n`;

const snapshots: DriveFolder = {
  folder: `${runFolder}/restic-repo/snapshots`,
  // No `filesystem list --json` of this level: names from the download, dated by restic.
  archives: downloadedNames(downloadTree, 'restic-repo/snapshots').map((name) => ({
    name,
    snapshot: name.slice(0, 8),
    detail: name === snapshot.id ? `taken ${formatTime(snapshot.time)}` : undefined,
    tree: name === ls.snapshot.id ? {
      id: name,
      summary: `${formatTime(ls.snapshot.time)} · ${ls.snapshot.username}@${ls.snapshot.hostname} · ${ls.snapshot.paths.join(', ')} · tag ${ls.snapshot.tags?.join(', ')}`,
      nodes: ls.nodes.map((n) => ({ path: n.path, permissions: n.permissions, size: n.size, contents: n === hello ? helloContents : undefined })),
    } : undefined,
  })),
};

const repo: DriveFolder = {
  folder: `${runFolder}/restic-repo`,
  archives: driveEntries(repoListing as ProtonDriveNode[])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, detail: describeEntry(e), open: e.name === 'snapshots' ? snapshots : undefined })),
};

export const runInDrive: Investigation = {
  drive: {
    folder: runFolder,
    archives: driveEntries(runFolderListing as ProtonDriveNode[])
      .map((e) => ({ name: e.name, detail: describeEntry(e), open: e.name === 'restic-repo' ? repo : undefined })),
  },
  vault: 'investigations',
  question: inDrive.question,
  agent: [],
};
