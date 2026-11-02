import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const app = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(app, '../.dagger/internal/devenv-base/toolbox/claim-page.html');
// Keep external React imports resolvable without bundling a second React copy.
const cache = path.join(app, 'node_modules/.cache');
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(path.join(cache, 'claim-template-'));
try {
  const renderer = path.join(temporary, 'render.mjs');
  await build({ entryPoints: [path.join(app, 'scripts/render-claim-page.tsx')], outfile: renderer, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'text' }, logLevel: 'warning' });
  const { renderTemplate } = await import(pathToFileURL(renderer).href);
  const browser = await build({ entryPoints: [path.join(app, 'scripts/claim-browser.ts')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2022', logLevel: 'warning' });
  const script = browser.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const html = '<!-- Generated from tutorial-app Storybook components. Run npm run claim:export there. -->\n' + renderTemplate(app, script);
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== html) throw new Error('Claim page template is stale. Run npm run claim:export in tutorial-app.');
    console.log('Claim page template matches the Storybook components.');
  } else {
    await writeFile(output, html);
    console.log(`Exported ${output}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
