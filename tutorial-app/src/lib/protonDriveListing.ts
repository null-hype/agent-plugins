// CIT-386: what the Drive pane shows, from `proton-drive filesystem list --json`.
// No Monaco or VS Code here, so the extension and the stories can share it.
// The shape follows CIT-378's live listing (see
// src/stories/fixtures/protondrive/README.md): only the fields the pane reads.

/** A decrypted field: the CLI prints `ok: false` when it couldn't decrypt it. */
export type Decrypted<T> = { ok: true; value: T } | { ok: false; error?: unknown };

/** One node of a `filesystem list --json` array. */
export type ProtonDriveNode = {
  uid: string;
  parentUid?: string;
  name: Decrypted<string>;
  type: 'file' | 'folder';
  modificationTime: string;
  /** Absent on a folder. */
  activeRevision?: { claimedSize?: number };
  /** Present on a folder only. */
  folder?: { isImported: boolean };
};

/** One line of the Drive pane. */
export type DriveEntry = {
  uid: string;
  /** The node's name, or its uid when the name couldn't be decrypted. */
  name: string;
  type: 'file' | 'folder';
  /** The size the uploader claimed, in bytes; absent on a folder. */
  size?: number;
  modified: string;
};

/** The pane's entries, in the order the CLI listed them. */
export const driveEntries = (nodes: ProtonDriveNode[]): DriveEntry[] =>
  nodes.map((node) => ({
    uid: node.uid,
    name: node.name.ok ? node.name.value : node.uid,
    type: node.type,
    size: node.activeRevision?.claimedSize,
    modified: node.modificationTime,
  }));

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** `411` → `411 B`, `2048` → `2 KB`. */
export const formatSize = (bytes: number) => {
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${unit ? Number(n.toFixed(1)) : n} ${UNITS[unit]}`;
};

/** What follows an entry's name in the pane: `411 B · 2026-10-09 20:23 UTC`, or `folder · …`. */
export const describeEntry = (e: DriveEntry) =>
  `${e.size === undefined ? e.type : formatSize(e.size)} · ${e.modified.slice(0, 16).replace('T', ' ')} UTC`;

/**
 * The names directly inside `dir` in `proton-drive filesystem download`'s
 * tree (`find .` of the download folder, one `./path` per line), sorted. An
 * empty folder isn't recreated locally, so it has no names here.
 */
export const downloadedNames = (tree: string, dir: string) => {
  const prefix = `./${dir.replace(/\/$/, '')}/`;
  const names = tree.split('\n').filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).split('/')[0]);
  return [...new Set(names)].sort();
};
