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

// A draft is a child id listed under `drafts` in its parent's meta.md. Its
// built payloads are named from the id path, e.g. `part-4-<chapter>-<lesson>-files.json`.
function draftPrefixes(dir, segments) {
  const prefixes = [];
  const meta = frontmatter(dir);
  for (const draft of meta.drafts ?? []) prefixes.push([...segments, draft].join('-') + '-');
  for (const id of [...(meta.parts ?? []), ...(meta.chapters ?? []), ...(meta.lessons ?? [])]) {
    if (meta.drafts?.includes(id)) continue;
    const child = join(dir, id);
    if (existsSync(child)) prefixes.push(...draftPrefixes(child, [...segments, id]));
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
