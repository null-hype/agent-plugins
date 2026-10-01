import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pkl from '../pkl.mjs';
import { reconcile } from '../reconcile.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'hotdog-is-sandwich';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const expected = pkl.load(path.join(here, 'report-expected.pcf'));

function run(answers, extraArgs = []) {
  const temp = mkdtempSync(path.join(tmpdir(), 'jev-answers-'));
  try {
    const filename = path.join(temp, 'answers.json');
    writeFileSync(filename, JSON.stringify(answers));
    const result = spawnSync(process.execPath, ['run.mjs', '--mock-answers', filename, ...extraArgs], {
      cwd: here, encoding: 'utf8', timeout: 30_000,
    });
    const runDir = result.stdout?.match(/artifacts: (.+)/)?.[1];
    assert.ok(runDir, result.stderr || result.error?.message);
    return { ...result, runDir, comparison: read(path.join(runDir, 'comparison.json')) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('Pkl → Playwright → Jev → JSON reconciliation passes without leaking expectations', () => {
  const result = run({ [id]: 0.9 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.comparison.passed, true);
  const request = read(path.join(result.runDir, 'questions', id, 'request.json'));
  assert.deepEqual(Object.keys(request).sort(), ['model', 'questions', 'state']);
  assert.deepEqual(request.questions, { [id]: expected.questions[id].judge });
  assert.deepEqual(request.state, { 'food-description': 'A cooked sausage served in a split bread roll.' });

  // Comparison really consumes the native report, not just the reporter ledger.
  const nativeFile = path.join(result.runDir, 'playwright-report.json');
  const native = read(nativeFile);
  native.suites = [];
  writeFileSync(nativeFile, JSON.stringify(native));
  assert.equal(reconcile(result.runDir).passed, false);
});

test('a valid low score is an expectation failure, not an execution failure', () => {
  const result = run({ [id]: 0.2 });
  assert.equal(result.status, 1);
  assert.equal(result.comparison.questions[id].executionPassed, true);
  assert.equal(result.comparison.questions[id].expectationPassed, false);
});

test('adding a question only in Pkl registers and scores another test', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'jev-two-questions-'));
  try {
    const contract = path.join(temp, 'two.pcf');
    const base = pathToFileURL(path.join(here, 'report-expected.pcf')).href;
    writeFileSync(contract, `amends "${base}"\nimport "${base}" as Base\nquestions { ["another-question"] = Base.questions["${id}"] }`);
    const result = run({ [id]: 0.9, 'another-question': 0.85 }, ['--contract', contract]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(Object.keys(result.comparison.questions).sort(), ['another-question', id]);
    assert.equal(result.comparison.questions['another-question'].probability, 0.85);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

for (const [name, answers] of [['missing answer', {}], ['invalid probability', { [id]: 1.5 }]]) {
  test(`${name} fails execution and preserves the raw Jev response`, () => {
    const result = run(answers);
    assert.equal(result.status, 1);
    assert.equal(result.comparison.questions[id].executionPassed, false);
    assert.equal(result.comparison.questions[id].probability, null);
    assert.match(result.comparison.questions[id].error, /response rejected by Jev.pkl/);
    assert.ok(read(path.join(result.runDir, 'questions', id, 'response.json')).answers);
  });
}

function compare(change) {
  const observed = {
    runId: 'test-run', contractDigest: 'test-digest', runnerErrors: 0,
    scores: { [id]: { backend: 'mock', model: 'jev-latest', probability: 0.9, error: null } },
    executions: [{ questionId: id, status: 'passed', evidenceId: id,
      evidenceKeys: ['food-description'], attachmentCount: 1 }],
  };
  change(observed);
  const temp = mkdtempSync(path.join(tmpdir(), 'jev-compare-'));
  try {
    writeFileSync(path.join(temp, 'expected.json'), JSON.stringify(expected));
    writeFileSync(path.join(temp, 'observed.json'), JSON.stringify(observed));
    return pkl.load(path.join(here, 'pkl/Reconcile.pkl'), {
      expected: pathToFileURL(path.join(temp, 'expected.json')).href,
      observed: pathToFileURL(path.join(temp, 'observed.json')).href,
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

for (const [name, change] of [
  ['missing execution', o => { o.executions = []; }],
  ['duplicate execution', o => { o.executions.push(o.executions[0]); }],
  ['unexpected score', o => { o.scores.other = o.scores[id]; }],
  ['missing evidence', o => { o.executions[0].evidenceKeys = []; }],
  ['skipped test', o => { o.executions[0].status = 'skipped'; o.executions[0].attachmentCount = 0; }],
  ['mismatched attachment', o => { o.executions[0].evidenceId = 'other'; }],
  ['runner error', o => { o.runnerErrors = 1; }],
]) {
  test(`Pkl rejects ${name}`, () => assert.equal(compare(change).passed, false));
}

test('Pkl rejects malformed observed score types', () => {
  assert.throws(() => compare(o => { o.scores[id].probability = '0.9'; }));
});

test('Pkl rejects reversed expected ranges before execution', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'jev-contract-'));
  try {
    const contract = path.join(temp, 'invalid.pcf');
    writeFileSync(contract, `amends "${pathToFileURL(path.join(here, 'report-expected.pcf')).href}"\nquestions { ["${id}"] { expected {\nmin = 0.9\nmax = 0.2\n} } }`);
    assert.throws(() => pkl.load(contract), error => error.stderr.includes('isBetween(min, 1)'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
