// CIT-397: one case, re-recorded from scratch, ending with `pkl test`.
//
//   node run-case.mjs <sha> <report-dir>
//
// The case is `cases/<hash>/`, its hash the sha's first 10 characters. Each
// step rewrites one evidence file there from its source: git -> commit.txt, Vale -> vale.json, Pkl -> frame.json,
// the story's play run in a browser -> rendered.json. Jev is not called yet,
// so recordings.json stays the committed one. Then `pkl test` runs the
// rendering facts (Rendered.test.pkl) and the issue's sketch facts.
//
// The report's `consistent` is false only when a step could not run, a
// re-recorded file differs from the committed one, or a rendering fact fails.
// The sketch's facts are rows of the report: the sketch failing is a finding.
// Nothing here reads whether the commit was later reverted.
//
// `RailsClaim` in .dagger/rails_claims.go runs this in a container; run
// locally, it rewrites the case in place and `git diff` shows any drift.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const [sha, report] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !report) throw new Error('usage: node run-case.mjs <full sha> <report-dir>');
const hash = sha.slice(0, 10);
const here = fileURLToPath(new URL('.', import.meta.url));
const app = fileURLToPath(new URL('../../../', import.meta.url));
const dir = `${here}cases/${hash}/`;
const RECORDED = ['commit.txt', 'vale.json', 'frame.json', 'rendered.json'];
const read = (f) => { try { return readFileSync(dir + f, 'utf8'); } catch { return null; } };
const committed = Object.fromEntries(RECORDED.map((f) => [f, read(f)]));
const broken = [];
const steps = {};

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
};
const step = async (name, fn) => {
  try {
    steps[name] = (await fn()) ?? 'ok';
  } catch (e) {
    steps[name] = 'failed';
    broken.push(`${name}: ${e.message}`);
  }
};
// `pkl test` output: "  <fact> ✅|❌", one line per fact.
const facts = (out) => Object.fromEntries([...out.matchAll(/^ {2}(\S.*?) (✅|❌)$/gm)].map(([, n, m]) => [n, m === '✅']));

await step('git', () => {
  // One commit, no blobs: its message is the raw commit object after the headers.
  const repo = mkdtempSync(`${tmpdir()}/rails-`);
  for (const args of [['init', '-q'], ['fetch', '-q', '--depth=1', '--filter=blob:none', 'https://github.com/rails/rails', sha]]) {
    const r = run('git', args, { cwd: repo });
    if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
  }
  const object = run('git', ['cat-file', 'commit', 'FETCH_HEAD'], { cwd: repo }).stdout;
  writeFileSync(dir + 'commit.txt', object.slice(object.indexOf('\n\n') + 2));
});

await step('vale', () => {
  // Vale exits 1 when it has alerts; that's the expected case here.
  const r = run('vale', ['--output=JSON', `../cases/${hash}/commit.txt`], { cwd: here + 'vale/' });
  const alerts = Object.values(JSON.parse(r.stdout)).flat()
    .map(({ Check, Line, Span, Match, Message }) => ({ Check, Line, Span, Match, Message }));
  writeFileSync(dir + 'vale.json', JSON.stringify(alerts, null, 1) + '\n');
});

await step('frame', () => {
  const r = run('pkl', ['eval', '-f', 'json', '-p', `hash=${hash}`, here + 'Frame.pkl']);
  if (r.status !== 0) throw new Error(r.stderr.trim());
  writeFileSync(dir + 'frame.json', r.stdout);
});

steps.jev = 'skipped: no Jev call yet, recordings.json is the committed one';

await step('render', () => {
  const r = run('npx', ['playwright', 'test', '--config=playwright.rails-claims.config.ts'], {
    cwd: app, env: { ...process.env, RAILS_CLAIM: hash },
  });
  if (r.status !== 0) throw new Error(`playwright exit ${r.status}\n${r.stdout.slice(-4000)}`);
});

for (const f of RECORDED) {
  if (read(f) !== committed[f]) broken.push(`drift: ${f} differs from the committed copy (export the case and review the diff)`);
}

let rendered = {};
let sketch = {};
await step('pkl test', () => {
  rendered = facts(run('pkl', ['test', '-p', `hash=${hash}`, 'Rendered.test.pkl'], { cwd: here }).stdout);
  sketch = facts(run('pkl', ['test', 'sketch_test.pkl'], { cwd: dir }).stdout);
  if (!Object.keys(rendered).length) throw new Error('Rendered.test.pkl reported no facts');
  for (const [fact, ok] of Object.entries(rendered)) if (!ok) broken.push(`rendered: ${fact}`);
});

const verdict = { case: hash, consistent: broken.length === 0, broken, steps, rendered, sketch };
mkdirSync(report, { recursive: true });
cpSync(dir, `${report}/${hash}`, { recursive: true });
writeFileSync(`${report}/consistency.json`, JSON.stringify(verdict, null, 2) + '\n');
console.log(JSON.stringify(verdict, null, 2));
