import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claimText } from '../src/stories/duo/cards.ts';
import { leftPageDocument } from '../src/stories/duo/leftPage.ts';

// Writes the page the native WKWebView loads: dist/duo/left-page.html with the
// claim inlined, and Monaco beside it at dist/duo/monaco/vs, where the page's
// relative loader looks. Open the file directly; no server is needed.
const out = new URL('../dist/duo/', import.meta.url);
const monaco = new URL('../node_modules/monaco-editor/min/vs', import.meta.url);

const template = readFileSync(new URL('../src/stories/duo/left-page.html', import.meta.url), 'utf8');
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('monaco/', out), { recursive: true });
cpSync(monaco, new URL('monaco/vs', out), { recursive: true });
writeFileSync(new URL('left-page.html', out), leftPageDocument(template, claimText));
console.log(`wrote ${fileURLToPath(new URL('left-page.html', out))}`);
