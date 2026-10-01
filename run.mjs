import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile } from './reconcile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  backend: { type: 'string', default: 'mock' },
  contract: { type: 'string', default: path.join(here, 'report-expected.pcf') },
  'mock-answers': { type: 'string', default: path.join(here, 'fixtures/answers.json') },
  'secret-ref': { type: 'string' },
} });
if (!['mock', 'real'].includes(values.backend)) throw new Error('--backend must be mock or real');
if (values.backend === 'real' && !values['secret-ref']?.startsWith('pass://')) {
  throw new Error('Use --secret-ref pass://vault/item/field for a live run.');
}
const runId = randomUUID();
const runDir = path.join(here, 'runs', runId);
mkdirSync(runDir, { recursive: true });
const env = { ...process.env, JEV_RUN_ID: runId, JEV_RUN_DIR: runDir,
  JEV_BACKEND: values.backend, JEV_CONTRACT: path.resolve(values.contract),
  JEV_MOCK_ANSWERS: path.resolve(values['mock-answers']), JEV_SECRET_REF: values['secret-ref'] ?? '' };
delete env.JEV_CONTRACT_SNAPSHOT;
const child = spawnSync(process.execPath, [path.join(here, 'node_modules/@playwright/test/cli.js'),
  'test', '--config', path.join(here, 'playwright.config.ts')], { cwd: here, env, stdio: 'inherit' });
let success = false;
try {
  const comparison = reconcile(runDir);
  success = child.status === 0 && comparison.passed;
  for (const [id, result] of Object.entries(comparison.questions)) {
    console.log(`${id}: ${result.probability ?? 'no score'}; execution=${result.executionPassed}; expectation=${result.expectationPassed}`);
  }
} catch (error) {
  const message = error.stderr?.toString() || error.message;
  writeFileSync(path.join(runDir, 'validation-error.txt'), message + '\n');
  console.error(message);
}
console.log(`${success ? 'PASS' : 'FAIL'} — artifacts: ${runDir}`);
process.exitCode = success ? 0 : 1;
