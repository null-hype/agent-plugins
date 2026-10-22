// Serves the built Storybook (storybook build -o /tmp/sb-out) and screenshots the
// Duo/Left page story with the claim, the card markers and an option preview showing.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.argv[2] ?? '/tmp/sb-out';
const out = process.argv[3] ?? new URL('./duo-left-page-story.png', import.meta.url).pathname;
const cards = JSON.parse(await readFile(new URL('../../src/stories/duo/cards.json', import.meta.url), 'utf8'));
const card = cards.find((c) => c.counterexample);
const option = card.options[0];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

const server = createServer(async (req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
	try {
		const body = await readFile(join(root, path === '/' ? 'index.html' : path));
		res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 460 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/iframe.html?id=duo-left-page--the-claim-with-its-cards&viewMode=story`);

const frameHandle = await page.waitForSelector('iframe[title="duo left page"]', { timeout: 30000 });
const frame = await frameHandle.contentFrame();
await frame.waitForFunction(() => window.showCards && window.monaco?.editor.getEditors().length, null, { timeout: 30000 });
// let the story's own play() run to the end before driving the page by hand
await page.waitForTimeout(8000);

await frame.evaluate(({ cards, card, option }) => {
	window.clearPreview();
	window.showCards(cards);
	window.previewOption(card.id, option.id);
}, { cards, card, option });
await frame.waitForSelector('.squiggly-error');
await frame.waitForSelector('.squiggly-info');
await frame.waitForSelector('.duo-preview-removed');

// the story's play() types into the read-only editor, which leaves Monaco's
// "Cannot edit in read-only editor" message over the claim; close it before the shot
await frame.evaluate(() => window.monaco.editor.getEditors()[0].trigger('capture', 'leaveEditorMessage', null));
await frame.waitForSelector('.monaco-editor-overlaymessage', { state: 'detached', timeout: 5000 });

const state = await frame.evaluate(() => ({
	markers: window.monaco.editor.getModelMarkers({ owner: 'duo-cards' }).length,
	previewRemoved: document.querySelectorAll('.duo-preview-removed').length,
	readOnly: window.monaco.editor.getEditors()[0].getOption(window.monaco.editor.EditorOption.readOnly),
}));
console.log(JSON.stringify({ ...state, pageErrors: errors }));
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
server.close();
