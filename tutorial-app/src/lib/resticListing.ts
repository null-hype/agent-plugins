// CIT-388: a restic snapshot as `restic snapshots --json` and `restic ls --json`
// print it, for opening a snapshot from the Drive pane. No Monaco or VS Code
// here. The shapes follow CIT-378's second live run (restic 0.18.1, see
// src/stories/fixtures/protondrive/README.md): only the fields the pane reads.

/** One snapshot from `restic snapshots --json`, or the first line of `restic ls --json`. */
export type ResticSnapshot = {
  id: string;
  short_id: string;
  time: string;
  tree: string;
  paths: string[];
  hostname: string;
  username: string;
  tags?: string[];
};

/** One node from `restic ls --json`. */
export type ResticNode = {
  name: string;
  type: 'file' | 'dir' | 'symlink' | string;
  path: string;
  size?: number;
  permissions?: string;
  mtime: string;
};

/** `restic ls --json <id>`: one JSON object per line, the snapshot first, then its nodes. */
export function parseResticLs(ndjson: string): { snapshot: ResticSnapshot; nodes: ResticNode[] } {
  const [first, ...rest] = ndjson.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (first?.struct_type !== 'snapshot') throw new Error('restic ls --json: the first line is not the snapshot');
  return { snapshot: first, nodes: rest.filter((n) => n.struct_type === 'node') };
}

/** `2026-10-09T22:05:08.699Z` → `2026-10-09 22:05 UTC`. */
export const formatTime = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
