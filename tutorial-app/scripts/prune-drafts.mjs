#!/usr/bin/env node
// Remove draft lessons' leftovers from a TutorialKit build.
//
// src/content/config.ts already keeps drafts out of the routes and the
// prev/next links, but TutorialKit still writes every lesson's
// `<slug>-files.json` / `<slug>-solution.json` payload into dist/, so a draft's
// source files would still be published. The GitHub Action that deploys the
// tutorial runs this after `npm run build` so that only non-draft lessons ship.
//
// Usage: node scripts/prune-drafts.mjs [dist-dir]   (default: dist)
import { readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const content = join(root, 'src/content/tutorial');
const dist = join(root, process.argv[2] ?? 'dist');

function frontmatter(dir) {
  const file = join(dir, 'meta.md');
  if (!existsSync(file)) return {};
  const match = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return (match && yaml.load(match[1])) || {};
}

// A draft is a child id listed under `drafts` in a tutorial or part meta.md,
// the two levels src/content/config.ts filters (`parts` and `chapters`). Its
// built payloads are named from the id path, e.g. `part-4-<chapter>-<lesson>-files.json`.
// Children come from the filesystem, not the order arrays: TutorialKit finds
// directories a meta.md leaves out of `parts`/`chapters` (part-0, part-1).
function draftPrefixes(dir, segments) {
  const prefixes = [];
  const meta = frontmatter(dir);
  const drafts = meta.drafts ?? [];
  if (meta.type === 'tutorial' || meta.type === 'part') {
    for (const draft of drafts) prefixes.push([...segments, draft].join('-') + '-');
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || drafts.includes(entry.name)) continue;
    prefixes.push(...draftPrefixes(join(dir, entry.name), [...segments, entry.name]));
  }
  return prefixes;
}

const prefixes = draftPrefixes(content, []);
const removed = [];
for (const name of readdirSync(dist)) {
  if (name.endsWith('.json') && prefixes.some((p) => name.startsWith(p))) {
    rmSync(join(dist, name));
    removed.push(name);
  }
}
console.log(`prune-drafts: ${prefixes.length} draft(s), removed ${removed.length} file(s) from ${dist}`);
