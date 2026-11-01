// Draws the jev-lsp lesson's two figures from what the language server actually
// returns. It starts jev-playwright/lsp, opens the real tests/questions.spec.ts
// against the recorded mock run, and draws the diagnostics it publishes and the
// evidence its go-to-definition opens. The run markers are the lines Playwright
// reported a test on. Nothing in a figure is typed by hand.
//
//   npm run jev-lsp:render     redraw after an intentional change
//   npm run jev-lsp:check      fail if a committed figure differs from a fresh run
//
// Needs Go. The figures are sketches: black and white, hand-drawn, phone width.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import rough from 'roughjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = path.resolve(here, '../../jev-playwright');
const specPath = path.join(harness, 'tests/questions.spec.ts');
const SPEC_LABEL = 'tests/questions.spec.ts';
const runDir = path.join(harness, 'lsp/testdata/mock-run');
const outDir = path.resolve(here, '../public/sketches/jev-lsp');
const QUESTION = 'baseline-alice-reads';

type Range = { start: { line: number; character: number }; end: { line: number; character: number } };
type Diagnostic = { range: Range; severity: number; code: string; message: string };

// --- ask the server ---------------------------------------------------------

const text = readFileSync(specPath, 'utf8');
const lines = text.replace(/\n$/, '').split('\n');
const uri = pathToFileURL(specPath).href;
// Where Playwright reported each Question's test, from the recorded run.
const recorded = JSON.parse(readFileSync(path.join(runDir, 'comparison.json'), 'utf8')).questions;
const testLines = new Set(Object.values(recorded).map((q: any) => q.location.line - 1));
const keyLine = recorded[QUESTION].location.line - 1;

const frame = (m: object) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...m }));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};
const input = Buffer.concat([
  frame({ id: 1, method: 'initialize', params: {} }),
  frame({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'pkl', version: 1, text } } }),
  frame({ id: 2, method: 'textDocument/definition', params: { textDocument: { uri }, position: { line: keyLine, character: 4 } } }),
  frame({ id: 3, method: 'shutdown' }),
  frame({ method: 'exit' }),
]);
const server = spawnSync('go', ['run', '.'], {
  cwd: path.join(harness, 'lsp'), input, env: { ...process.env, JEV_RUN_DIR: runDir },
});
if (server.status !== 0) throw new Error(`jev-lsp failed: ${server.stderr}`);

let diagnostics: Diagnostic[] = [];
let definition: { uri: string }[] = [];
for (let out = server.stdout; out.length;) {
  const head = out.indexOf('\r\n\r\n');
  const length = Number(/Content-Length: (\d+)/.exec(out.subarray(0, head).toString())![1]);
  const message = JSON.parse(out.subarray(head + 4, head + 4 + length).toString());
  out = out.subarray(head + 4 + length);
  if (message.method === 'textDocument/publishDiagnostics') diagnostics = message.params.diagnostics;
  if (message.id === 2) definition = message.result ?? [];
}
if (diagnostics.length !== 1 || diagnostics[0].range.start.line !== keyLine) {
  throw new Error(`expected one diagnostic, on ${QUESTION}; got ${JSON.stringify(diagnostics)}`);
}
if (!definition.length) throw new Error('go to definition returned no evidence');

// --- draw -------------------------------------------------------------------

const W = 360;
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const HAND = "Virgil, 'Comic Sans MS', 'Segoe Print', cursive";
const CHAR = 7.2; // width of one 12px monospace character
const gen = rough.generator();
let seed = 1;
const ink = { stroke: '#111', strokeWidth: 1.2, roughness: 1.1 };

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const paths = (d: ReturnType<typeof gen.rectangle>) =>
  gen.toPaths(d).map((p) => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? 'none'}"/>`).join('');
const box = (x: number, y: number, w: number, h: number, o = {}) => paths(gen.rectangle(x, y, w, h, { ...ink, seed: seed++, ...o }));
const rule = (x1: number, y1: number, x2: number, y2: number, o = {}) => paths(gen.line(x1, y1, x2, y2, { ...ink, seed: seed++, ...o }));
const code = (x: number, y: number, s: string, o = '') => `<text x="${x}" y="${y}" font-family="${MONO}" font-size="12" xml:space="preserve"${o}>${esc(s)}</text>`;
const hand = (x: number, y: number, s: string, size = 14, o = '') => `<text x="${x}" y="${y}" font-family="${HAND}" font-size="${size}"${o}>${esc(s)}</text>`;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const wrap = (s: string, n: number) => {
  const out: string[] = []; let line = '';
  for (const word of s.split(' ')) {
    if (line && (line + ' ' + word).length > n) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  return [...out, line];
};
const svg = (h: number, label: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img" aria-label="${esc(label)}">` +
  `<rect width="100%" height="100%" fill="#fff"/>${body}</svg>\n`;

// Figure 1: the spec, with the published diagnostic under the test that asked.
function editor(): string {
  const d = diagnostics[0];
  const first = 0;
  const shown = lines;
  const gutter = 40, x0 = 14 + gutter, cols = Math.floor((W - x0 - 18) / CHAR), lh = 19;
  let y = 54, body = '';
  body += hand(16, 26, SPEC_LABEL, 15, ' font-weight="bold"');
  body += hand(W - 16, 26, `${diagnostics.length} problem`, 13, ' text-anchor="end"');
  for (const [i, src] of shown.entries()) {
    const n = first + i;
    body += code(16, y, String(n + 1).padStart(2), ' fill="#777"');
    if (testLines.has(n)) body += hand(16 + 19, y, '▶', 11);
    body += code(x0, y, clip(src, cols));
    if (n === d.range.start.line) {
      body += hand(16 + 30, y, '!', 14, ' font-weight="bold"');
      // squiggle under the exact range the server published
      const a = x0 + d.range.start.character * CHAR, b = x0 + Math.min(d.range.end.character, cols) * CHAR;
      const pts: [number, number][] = [];
      for (let x = a, k = 0; x <= b; x += 4, k++) pts.push([x, y + 5 + (k % 2 ? 2.5 : -0.5)]);
      body += paths(gen.linearPath(pts, { ...ink, roughness: 0.3, seed: seed++ }));
      // the diagnostic, shown inline under its line
      const msg = wrap(d.message, Math.floor((W - x0 - 26) / 6.4));
      const top = y + 12, h = 30 + msg.length * 17;
      body += box(x0 - 4, top, W - x0 - 10, h);
      body += hand(x0 + 6, top + 18, `jev · ${d.code}`, 12, ' fill="#555"');
      msg.forEach((m, j) => (body += hand(x0 + 6, top + 36 + j * 17, m, 13)));
      y = top + h + lh;
      continue;
    }
    y += lh;
  }
  body += box(6, 6, W - 12, y - 6 - lh + 12, { roughness: 1.4 });
  body += rule(14, 38, W - 14, 38, { roughness: 0.8 });
  return svg(y - lh + 24, `Editor showing ${SPEC_LABEL} with one warning, under the test that asked ${QUESTION}`, body);
}

// Figure 2: peek on that question, opened on the first evidence file.
function peek(): string {
  const files = definition.map((l) => path.relative(path.join(runDir, 'questions'), fileURLToPath(l.uri)));
  const evidence = JSON.parse(readFileSync(fileURLToPath(definition[0].uri), 'utf8')).state;
  const excerpt = JSON.stringify({ policy: evidence.authorizationPolicy, http: evidence.http }, null, 2).split('\n');
  const cols = Math.floor((W - 44) / CHAR);
  let body = '', y = 30;
  body += hand(16, y, `peek · line ${keyLine + 1}`, 15, ' font-weight="bold"');
  y += 26;
  files.forEach((f, i) => {
    body += hand(28, y, `${i === 0 ? '▸ ' : '  '}${f}`, 14, i === 0 ? ' font-weight="bold"' : '');
    y += 20;
  });
  body += rule(14, y - 6, W - 14, y - 6, { roughness: 0.8 });
  y += 14;
  for (const l of excerpt) { body += code(26, y, clip(l, cols)); y += 17; }
  body += box(6, 6, W - 12, y - 6, { roughness: 1.4 });
  return svg(y + 8, `Peek on line ${keyLine + 1}, listing ${files.join(', ')}, showing ${files[0]}`, body);
}

const figures = { 'diagnostic.svg': editor(), 'peek.svg': peek() };
mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(figures)) {
  const target = path.join(outDir, name);
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content) throw new Error(`${name} is stale; run npm run jev-lsp:render`);
  } else writeFileSync(target, content);
}
console.log(`${diagnostics[0].range.start.line + 1}: ${diagnostics[0].message}`);
console.log(`peek: ${definition.map((l) => path.relative(path.join(runDir, 'questions'), fileURLToPath(l.uri))).join(', ')}`);
