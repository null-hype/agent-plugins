/**
 * Print shareable links for a projected thread:
 *
 *   npm run feed:link -- src/feed/<slug>.recording.json [--frame f2] [--storybook http://localhost:6007]
 *
 * The encoded link renders in Storybook and the dev homepage only; the public
 * site takes published ids (`?thread=<slug>`), see src/feed/published.ts.
 */
import { readFileSync } from 'node:fs';
import { decodeThread, encodeThread, MAX_LINK_LENGTH } from '../src/lib/threadLink';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const frame = flag('--frame');
const storybook = (flag('--storybook') ?? 'http://localhost:6007').replace(/\/$/, '');
const [path] = args;
if (!path) throw new Error('usage: delta-feed-link <recording.json> [--frame f2] [--storybook <url>]');

const link = encodeThread(JSON.parse(readFileSync(path, 'utf8')));
const check = decodeThread(link);
if ('reason' in check) throw new Error(`${path}: ${check.reason}`);
if (link.length > MAX_LINK_LENGTH) throw new Error(`${path}: link is ${link.length} characters; the limit is ${MAX_LINK_LENGTH}`);

const storyArgs = [`thread:${link}`, ...(frame ? [`frame:${frame}`] : [])].join(';');
console.log(JSON.stringify({
  characters: link.length,
  thread: link,
  storybook: `${storybook}/iframe.html?id=tidelands-delta-thread--from-link&args=${storyArgs}`,
  devHomepage: `http://localhost:4321/${frame ? `?frame=${frame}` : ''}#t=${link}`,
  previewProps: { thread: link, ...(frame ? { frame } : {}) },
}, null, 2));
