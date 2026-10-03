import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { score } from '../score.mjs';

test('container scoring uses the injected key and local client, with no pass-cli or Dagger invocation', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jev-env-test-'));
  const saved = { ...process.env };
  try {
    const python = path.join(dir, 'python');
    const capture = path.join(dir, 'capture.json');
    writeFileSync(python, `#!${process.execPath}
const fs=require('node:fs');
fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),key:process.env.TYPESAFE_API_KEY}));
console.log(JSON.stringify({backend:'real',model:'test',probabilities:{example:0.9}}));
`);
    chmodSync(python, 0o755);
    Object.assign(process.env, { JEV_CREDENTIALS: 'env', JEV_BACKEND: 'real', JEV_PYTHON: python,
      JEV_RUN_ID: 'container-test', TYPESAFE_API_KEY: 'synthetic-key',
      PROTON_PASS_AGENT_REASON: 'goal=jev-playwright-v0; action=playwright-run; run=container-test',
      // Any unintended external command must fail.
      PATH: dir,
    });
    const input = { id: 'example', model: 'test', runDir: dir, state: { evidence: true },
      question: { judge: { type: 'noul', instructions: 'Example?' }, expected: { min: 0.8, max: 1 } } };
    assert.equal((await score(input)).probability, 0.9);
    const call = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(call.key, 'synthetic-key');
    assert.ok(call.args[0].endsWith('/src/jev/jev'));
    assert.ok(!call.args.includes('synthetic-key'));
    const invocation = JSON.parse(readFileSync(path.join(dir, 'questions/example/invocation.json'), 'utf8'));
    assert.equal(invocation.credentialReason, process.env.PROTON_PASS_AGENT_REASON);
    process.env.TYPESAFE_API_KEY = 'pass://unresolved/item/key';
    await assert.rejects(score(input), /resolved TYPESAFE_API_KEY/);
    delete process.env.TYPESAFE_API_KEY;
    await assert.rejects(score(input), /resolved TYPESAFE_API_KEY/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(dir, { recursive: true, force: true });
  }
});
