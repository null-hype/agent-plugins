// Serves the built Storybook (storybook build -o /tmp/sb-out) and screenshots the
// Duo/Left page story with the claim, the card markers and an option preview showing.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.argv[2] ?? '/tmp/sb-out';
const out = process.argv[3] ?? new URL('./duo-left-page-story.png', import.meta.url).pathname;
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

const result = await frame.evaluate(() => {
	const cards = [...document.querySelectorAll('script')].length; // placeholder to keep evaluate synchronous
	return { cards };
});
void result;

await frame.evaluate(async () => {
	const { default: cards } = await import(location.origin + '/__never__').catch(() => ({ default: null }));
	void cards;
});
