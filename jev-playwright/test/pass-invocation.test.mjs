import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { score } from '../score.mjs';

test('host pass-cli invocation sets its fixed reason before secret resolution (stub executable)', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'jev-pass-stub-'));
  const saved = { ...process.env };
  try {
    const capture = path.join(temp, 'invocation.json');
    const stub = path.join(temp, 'pass-cli');
    writeFileSync(stub, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
  args: process.argv.slice(2), reason: process.env.PROTON_PASS_AGENT_REASON,
  key: process.env.TYPESAFE_API_KEY, unrelated: process.env.UNRELATED_SECRET,
  session: process.env.PROTON_PASS_SESSION_DIR
}));
console.log(JSON.stringify({backend: 'real', model: 'test-model', probabilities: {'example': 0.8}}));
`);
    chmodSync(stub, 0o755);
    Object.assign(process.env, {
      PATH: `${temp}${path.delimiter}${saved.PATH}`, JEV_BACKEND: 'real',
      JEV_RUN_ID: 'test-run', JEV_SECRET_REF: 'pass://test-vault/test-item/api-key',
      PROTON_PASS_AGENT_REASON: 'caller supplied reason',
      PROTON_PASS_SESSION_DIR: '/tmp/jev-test-session',
      UNRELATED_SECRET: 'pass://unrelated/item/password',
    });
    const result = await score({ id: 'example', model: 'test-model', runDir: temp,
      state: { description: 'test evidence' },
      question: { judge: { type: 'noul', instructions: 'Example?' }, expected: { min: 0.7, max: 1 } },
    });
    assert.equal(result.probability, 0.8);
    const invocation = JSON.parse(readFileSync(capture, 'utf8'));
    assert.deepEqual(invocation.args.slice(0, 2), ['run', '--']);
    assert.equal(invocation.reason, 'goal=jev-playwright-v0; action=jev-score; run=test-run; question=example');
    assert.equal(invocation.key, 'pass://test-vault/test-item/api-key');
    assert.equal(invocation.session, '/tmp/jev-test-session');
    assert.equal(invocation.unrelated, undefined);
    const questions = JSON.parse(readFileSync(path.join(temp, 'questions/example/questions.json'), 'utf8'));
    assert.deepEqual(questions, { example: { type: 'noul', instructions: 'Example?' } });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(temp, { recursive: true, force: true });
  }
});
