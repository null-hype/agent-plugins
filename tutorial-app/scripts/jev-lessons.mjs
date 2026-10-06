import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CIT-318: builds the part-5 lessons before the site or Storybook is built. They
// are not committed: the `jev:lesson` project renders them with JevReport.pkl from
// the committed run records (`evidence/jev-private-document`), so this needs only
// `pkl`, fetched here when it is not on PATH. It asks no Questions; recording a new
// run is `JEV_LESSON_ASK=mock|real` on that project (see jev-playwright/README.md).

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKL_VERSION = '0.32.1';

function hasPkl(env) {
  try {
    execFileSync('pkl', ['--version'], { env, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const env = { ...process.env, RAILS_PROBES_NO_SERVERS: '1' };
if (!hasPkl(env)) {
  const asset = { 'linux-x64': 'linux-amd64', 'linux-arm64': 'linux-aarch64', 'darwin-x64': 'macos-amd64', 'darwin-arm64': 'macos-aarch64' }[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`no pkl ${PKL_VERSION} build for ${process.platform}-${process.arch}; put pkl on PATH`);
  const dir = path.join(app, 'node_modules/.cache/pkl', PKL_VERSION);
  const bin = path.join(dir, 'pkl');
  if (!existsSync(bin)) {
    const response = await fetch(`https://github.com/apple/pkl/releases/download/${PKL_VERSION}/pkl-${asset}`);
    if (!response.ok) throw new Error(`downloading pkl ${PKL_VERSION}: ${response.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(bin, Buffer.from(await response.arrayBuffer()));
    chmodSync(bin, 0o755);
  }
  env.PATH = `${dir}${path.delimiter}${env.PATH}`;
}

const result = spawnSync(
  process.execPath,
  [path.join(app, 'node_modules/@playwright/test/cli.js'), 'test', '--config=playwright.questions.config.ts', '--project', 'jev:lesson'],
  { cwd: app, env, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
