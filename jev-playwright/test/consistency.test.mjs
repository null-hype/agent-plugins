import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConsistency } from '../consistency.mjs';

// CIT-320: the consistency check is independent of whether the run passed.
// An out-of-range answer, or one that disagrees with its deterministic anchor,
// is a row; a record that contradicts another record is not.

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'vulnerability-reproduced';
const second = 'exploit-prevented';
const good = { [id]: 0.95, [second]: 0.95, 'legitimate-access-preserved': 0.95 };
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

function run(answers) {
  const temp = mkdtempSync(path.join(tmpdir(), 'jev-consistency-'));
  try {
    const filename = path.join(temp, 'answers.json');
    writeFileSync(filename, JSON.stringify(answers));
    const result = spawnSync(process.execPath, ['run.mjs', '--mock-answers', filename], { cwd: here, encoding: 'utf8', timeout: 30_000 });
    const runDir = result.stdout?.match(/artifacts: (.+)/)?.[1];
    assert.ok(runDir, result.stderr || result.error?.message);
    return { ...result, runDir, consistency: read(path.join(runDir, 'consistency.json')) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('a passing run is consistent, and every answered question is checked against its records', () => {
  const { consistency } = run(good);
  assert.equal(consistency.consistent, true, consistency.broken.join('\n'));
  for (const finding of Object.values(consistency.findings)) {
    assert.equal(finding.outcome, 'in-range');
    assert.deepEqual(Object.keys(finding.rules).sort(), ['backend-labelled', 'dependency-order', 'evidence-sent',
      'executed-once', 'question-sent', 'required-evidence', 'score-on-record']);
  }
});

test('an out-of-range answer that disagrees with its anchor is a row, not an inconsistency', () => {
  const result = run({ ...good, [id]: 0.2 });
  assert.equal(result.status, 1, 'the investigation itself still fails its expectation');
  assert.equal(result.consistency.consistent, true, result.consistency.broken.join('\n'));
  assert.equal(result.consistency.findings[id].outcome, 'out-of-range');
  assert.equal(result.consistency.findings[id].disagreement, true);
  assert.equal(result.consistency.findings[second].outcome, 'dependency-skipped');
});

test('records that contradict each other make the run inconsistent', () => {
  const { runDir } = run(good);
  const tamper = (file, change) => {
    const target = path.join(runDir, 'questions', file);
    const original = readFileSync(target, 'utf8');
    const value = JSON.parse(original);
    change(value);
    writeFileSync(target, JSON.stringify(value));
    try {
      return checkConsistency(runDir, 'mock');
    } finally {
      writeFileSync(target, original);
    }
  };
  const broken = (result) => result.broken.map((line) => line.split(':').slice(0, 2).join(':'));

  // The score on record is not the one Jev returned.
  assert.deepEqual(broken(tamper(`${id}/response.json`, (r) => { r.answers[id].noul = 0.5; })), [`${id}: score-on-record`]);
  // Jev was sent evidence other than what the test recorded.
  assert.deepEqual(broken(tamper(`${second}/request.json`, (r) => { r.state.http.response.status = 200; })), [`${second}: evidence-sent`]);
  // The expected range reached Jev.
  assert.deepEqual(broken(tamper(`${id}/request.json`, (r) => { r.questions[id].expected = { min: 0.8, max: 1 }; })), [`${id}: question-sent`]);
  // The judge was asked something other than the declared question.
  assert.deepEqual(broken(tamper(`${id}/request.json`, (r) => { r.questions[id].criteria = { true: 'anything', false: 'nothing' }; })), [`${id}: question-sent`]);
  // The raw response names another model than the ledger.
  assert.deepEqual(broken(tamper(`${id}/response.json`, (r) => { r.model = 'jev-other'; })), [`${id}: score-on-record`]);
  // A canned answer presented as a real one.
  assert.deepEqual(broken(checkConsistency(runDir, 'real')).sort(),
    Object.keys(good).map((q) => `${q}: backend-labelled`).sort());
  // The contract changed after the run was reconciled.
  const contract = path.join(runDir, 'report-expected.json');
  const original = readFileSync(contract, 'utf8');
  const changed = JSON.parse(original);
  changed.questions[id].expected.min = 0.1;
  writeFileSync(contract, JSON.stringify(changed));
  try {
    assert.ok(broken(checkConsistency(runDir, 'mock')).includes('run: same-contract'));
  } finally {
    writeFileSync(contract, original);
  }
  // And untouched, it is consistent again.
  assert.equal(checkConsistency(runDir, 'mock').consistent, true);
});
