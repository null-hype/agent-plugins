// Render public/sketches/**/*.excalidraw to sibling SVGs (CIT-407).
//
// The .excalidraw file is the drawing; the SVG is what lessons show. This
// renders only what the first, black-and-white drawings use (rectangles and
// text, roughness 0) and throws on anything else, so a drawing that grows a
// new element type fails here instead of rendering wrong. Element ids become
// SVG ids, so a later check can colour individual elements.
//
//   npm run sketches:render            write the SVGs
//   npm run sketches:render -- --check fail if any SVG is stale
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Element = {
  type: string; id: string; x: number; y: number; width: number; height: number;
  strokeColor?: string; backgroundColor?: string; strokeWidth?: number; roughness?: number;
  roundness?: { type: number } | null; text?: string; fontSize?: number; fontFamily?: number;
};

const FONTS: Record<number, string> = {
  1: "Excalifont, Virgil, 'Comic Sans MS', cursive",
  2: 'Nunito, Helvetica, Arial, sans-serif',
  3: "'Cascadia Code', ui-monospace, Menlo, Consolas, monospace",
};
const PAD = 10;
const LINE_HEIGHT = 1.25;
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function renderSketch(source: string, label: string): string {
  const { elements } = JSON.parse(source) as { elements: Element[] };
  const minX = Math.min(...elements.map(e => e.x)) - PAD;
  const minY = Math.min(...elements.map(e => e.y)) - PAD;
  const maxX = Math.max(...elements.map(e => e.x + e.width)) + PAD;
  const maxY = Math.max(...elements.map(e => e.y + e.height)) + PAD;
  const body = elements.map(e => {
    if (e.roughness !== 0) throw new Error(`${label}#${e.id}: only roughness 0 is rendered`);
    const x = e.x - minX, y = e.y - minY;
    const stroke = e.strokeColor ?? '#1e1e1e';
    if (e.type === 'rectangle') {
      const rx = e.roundness ? Math.min(16, e.width / 4, e.height / 4) : 0;
      const fill = !e.backgroundColor || e.backgroundColor === 'transparent' ? 'none' : e.backgroundColor;
      return `<rect id="${escape(e.id)}" x="${x}" y="${y}" width="${e.width}" height="${e.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${e.strokeWidth ?? 2}"/>`;
    }
    if (e.type === 'text') {
      const size = e.fontSize ?? 20;
      const font = FONTS[e.fontFamily ?? 1];
      if (!font) throw new Error(`${label}#${e.id}: unknown fontFamily ${e.fontFamily}`);
      const lines = (e.text ?? '').split('\n').map((line, i) =>
        `<tspan x="${x}" y="${y + size + i * size * LINE_HEIGHT}">${escape(line)}</tspan>`).join('');
      return `<text id="${escape(e.id)}" fill="${stroke}" font-family="${escape(font)}" font-size="${size}" xml:space="preserve">${lines}</text>`;
    }
    throw new Error(`${label}#${e.id}: element type ${e.type} is not rendered`);
  });
  const width = maxX - minX, height = maxY - minY;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}"><rect width="100%" height="100%" fill="#ffffff"/>${body.join('')}</svg>\n`;
}

function sketchFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sketchFiles(path);
    return entry.name.endsWith('.excalidraw') ? [path] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const root = fileURLToPath(new URL('../public/sketches/', import.meta.url));
  const stale: string[] = [];
  for (const source of sketchFiles(root)) {
    const target = source.replace(/\.excalidraw$/, '.svg');
    const svg = renderSketch(readFileSync(source, 'utf8'), target.slice(root.length));
    if (!check) { writeFileSync(target, svg); console.log(`rendered ${target.slice(root.length)}`); continue; }
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch {}
    if (current !== svg) stale.push(target.slice(root.length));
  }
  if (stale.length) throw new Error(`Stale sketches; run npm run sketches:render: ${stale.join(', ')}`);
}
