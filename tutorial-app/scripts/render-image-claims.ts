import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runImageClaims } from '../src/lib/imageClaims.ts';
const fixtures = new URL('../src/stories/fixtures/image-claims/', import.meta.url);
const names = ['rails-canary.png', 'control.png', 'badge.svg', 'excalidraw-export.png', 'scene-missing-asset.png'];
const result = runImageClaims(names.map(path => ({ path, bytes: readFileSync(new URL(path, fixtures)) })));
// Bind the demonstrated input to both retained Rails runs; do not relabel those
// historical observations as a freshly executed integration test.
const sha = createHash('sha256').update(readFileSync(new URL('rails-canary.png', fixtures))).digest('hex');
for (const arm of ['mat-unblocked', 'mat-blocked']) {
  const obs = JSON.parse(readFileSync(new URL(`../../docs/investigations/CIT-265/cit-294/observations/${arm}.json`, import.meta.url), 'utf8'));
  if (obs.independent_source_sha256 !== sha) throw new Error(`Canary differs from retained ${arm} input`);
}
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const lines = [`PROBLEMS ${result.findings.length} · image-claims ${result.checker.version}`, 'Recorded checker output · Rails outcomes: retained evidence', ''];
for (const finding of result.findings) {
  lines.push(`${finding.path}:${finding.line}`);
  const words = finding.message.split(' '); let line = '  ';
  for (const word of words) {
    if (line.length + word.length > 88) { lines.push(line); line = '  '; }
    line += word + ' ';
  }
  lines.push(line.trimEnd(), '');
}
lines.push('No finding is not a safety verdict.');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="${lines.length * 22 + 32}" role="img" aria-label="Executed image checks"><rect width="100%" height="100%" fill="#f8fafc"/><g fill="#172033" font-family="monospace" font-size="14">${lines.map((line, i) => `<text x="20" y="${32 + i * 22}" xml:space="preserve">${escape(line)}</text>`).join('')}</g></svg>\n`;
const target = new URL('../public/sketches/image-claims/problems.svg', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== svg) throw new Error('Problems panel is stale; run npm run image-claims:render');
} else writeFileSync(target, svg);
console.log(result.raw);
