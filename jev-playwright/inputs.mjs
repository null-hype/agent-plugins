// What a run depends on, as two hashes.
//
// `code` covers the files the Dagger module copies into the run: the harness's
// scripts, contract, Pkl, tests and fixtures, and the Jev client. A run whose
// code hash differs from the files on disk was asked of other code: it is stale.
//
// `run` adds the choices made for one run: backend, canned answers, contract and
// an optional seed. It names a Dagger run, so the same inputs reuse the same
// result. Asking again on purpose takes a new seed.
//
//   node inputs.mjs            print the code hash
//   node inputs.mjs --run ...  print the run hash for these choices
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '../src/jev');

// The same files dagger/.dagger/main.go copies; keep the two in step.
const harnessTop = (name) => /\.(mjs|ts)$/.test(name) || name === 'report-expected.pcf';
const harnessDirs = ['pkl', 'tests', 'test', 'fixtures'];
const clientFiles = ['jev', 'jev_pkl.py'];
const clientDirs = ['pkl'];

const sha = (data) => createHash('sha256').update(data).digest('hex');

function walk(root, dir, out) {
  const full = path.join(root, dir);
  if (!existsSync(full)) return;
  for (const name of readdirSync(full).sort()) {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
}

/** Every input file, as `label path`, sorted. */
export function inputFiles() {
  const files = [];
  for (const name of readdirSync(here).sort()) {
    if (harnessTop(name) && statSync(path.join(here, name)).isFile()) files.push(['harness', here, name]);
  }
  for (const dir of harnessDirs) { const out = []; walk(here, dir, out); files.push(...out.map((f) => ['harness', here, f])); }
  for (const name of clientFiles) if (existsSync(path.join(client, name))) files.push(['client', client, name]);
  for (const dir of clientDirs) { const out = []; walk(client, dir, out); files.push(...out.map((f) => ['client', client, f])); }
  return files;
}

export function codeHash() {
  return sha(inputFiles().map(([label, root, rel]) => `${label} ${rel} ${sha(readFileSync(path.join(root, rel)))}\n`).join(''));
}

export function runHash({ backend = 'mock', answers = path.join(here, 'fixtures/answers.json'),
  contract = path.join(here, 'report-expected.pcf'), seed = '' } = {}) {
  const choices = [
    `code ${codeHash()}`,
    `backend ${backend}`,
    // Canned answers only matter to a mock run.
    `answers ${backend === 'mock' ? sha(readFileSync(answers)) : ''}`,
    `contract ${sha(readFileSync(contract))}`,
    `seed ${seed}`,
  ];
  return sha(choices.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    run: { type: 'boolean', default: false },
    backend: { type: 'string', default: 'mock' },
    'mock-answers': { type: 'string', default: path.join(here, 'fixtures/answers.json') },
    contract: { type: 'string', default: path.join(here, 'report-expected.pcf') },
    seed: { type: 'string', default: '' },
  } });
  console.log(values.run
    ? runHash({ backend: values.backend, answers: path.resolve(values['mock-answers']), contract: path.resolve(values.contract), seed: values.seed })
    : codeHash());
}
