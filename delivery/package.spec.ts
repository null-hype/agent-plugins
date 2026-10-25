import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type GeneratedFile } from './fixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = path.resolve(here, '..');
const client = path.resolve(harness, '../src/jev');
const read = (file: string) => readFileSync(file, 'utf8');
const run = (command: string, args: string[], cwd: string, env: Record<string, string> = {}) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10 * 60_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}` };
};

// What the session is given: the task, the harness as it stands, and this check.
const sources = [
  'ask.ts', 'reporter.ts', 'global-setup.ts', 'playwright.config.ts', 'run.mjs', 'score.mjs', 'pkl.mjs',
  'reconcile.mjs', 'consistency.mjs', 'report-ui.mjs', 'pkl/Experiment.pkl', 'pkl/Reconcile.pkl',
].map((f) => [`jev-playwright/${f}`, path.join(harness, f)])
  .concat(['Question.pkl', 'Jev.pkl', 'Consistency.pkl'].map((f) => [`src/jev/pkl/${f}`, path.join(client, 'pkl', f)]));
const check = ['fresh-project/package.json', 'fresh-project/playwright.config.ts', 'fresh-project/tests/moon.spec.ts',
  'fresh-project/questions.pcf', 'fresh-project/answers.json', 'fresh-project.lua', 'package.spec.ts']
  .map((f) => [`delivery/${f}`, path.join(here, f)]);
const listing = (files: string[][]) => files.map(([name, file]) => `### ${name}\n\n\`\`\`\n${read(file)}\`\`\`\n`).join('\n');
const prompt = `${read(path.join(here, 'prompts/package.md'))}
## The harness

${listing(sources)}
## The check

${listing(check)}`;

test('Does a fresh Playwright project that installs the package get a warning on the line of a test answered out of range?', async ({ dispatch }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const out = testInfo.outputPath();

  // DELIVERY_FILES checks a package from disk instead of asking Jules for one.
  const files: GeneratedFile[] = process.env.DELIVERY_FILES
    ? readdirSync(process.env.DELIVERY_FILES, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
      .map((e) => { const p = path.join(e.parentPath, e.name); return { path: path.join('package', path.relative(process.env.DELIVERY_FILES!, p)), changeType: 'created', content: read(p) }; })
    : await dispatch({ title: 'write the jev-lsp package', prompt });

  const pkg = await test.step('every file Jules wrote is a new file under package/', async () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.path.split(path.sep)[0] === 'package' || f.path.startsWith('package/'), f.path).toBe(true);
      expect(f.changeType, f.path).toBe('created');
      const target = path.join(out, f.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    return path.join(out, 'package');
  });

  const tarball = await test.step('it packs', async () => {
    const packed = run('npm', ['pack', '--silent', '--pack-destination', out], pkg);
    expect(packed.status, packed.output).toBe(0);
    return path.join(out, packed.output.trim().split('\n').at(-1)!);
  });

  const project = await test.step('a fresh project installs it', async () => {
    const dir = path.join(out, 'project');
    cpSync(path.join(here, 'fresh-project'), dir, { recursive: true });
    const playwright = JSON.parse(read(path.join(harness, 'node_modules/@playwright/test/package.json'))).version;
    const installed = run('npm', ['install', '--no-audit', '--no-fund', `@playwright/test@${playwright}`, tarball], dir);
    expect(installed.status, installed.output).toBe(0);
    return dir;
  });

  await test.step('its Question is answered, out of range, on the line that asked it', async () => {
    const ran = run('npx', ['playwright', 'test'], project, {
      JEV_CLIENT: path.join(client, 'jev'), JEV_PYTHON: path.join(harness, '.venv/bin/python'),
    });
    expect(ran.status, ran.output).toBe(0);
    const runs = path.join(project, 'runs');
    expect(existsSync(runs), ran.output).toBe(true);
    const [comparison] = readdirSync(runs).map((r) => path.join(runs, r, 'comparison.json')).filter(existsSync);
    const moon = JSON.parse(read(comparison)).questions.moon;
    expect(moon.outcome).toBe('out-of-range');
    expect(moon.location).toMatchObject({ file: 'tests/moon.spec.ts', line: 3 });
  });

  await test.step('Neovim shows the warning on that line', async () => {
    const server = path.join(out, 'jev-lsp');
    execFileSync('go', ['build', '-o', server, '.'], { cwd: path.join(harness, 'lsp') });
    const shown = run('nvim', ['--headless', '--clean',
      '-c', `lua vim.g.jev_lsp_cmd = '${server}'; vim.g.jev_run_on_save = false`,
      '-c', `luafile ${path.join(harness, 'lsp/nvim/jev.lua')}`,
      '-c', 'edit tests/moon.spec.ts',
      '-c', `luafile ${path.join(here, 'fresh-project.lua')}`], project);
    expect(shown.status, shown.output).toBe(0);
  });
});
