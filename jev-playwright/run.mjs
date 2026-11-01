import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  backend: { type: 'string', default: 'mock' },
  contract: { type: 'string', default: path.join(here, 'report-expected.pcf') },
  'mock-answers': { type: 'string', default: path.join(here, 'fixtures/answers.json') },
  'secret-ref': { type: 'string' },
  credentials: { type: 'string', default: 'pass' },
  'run-id': { type: 'string' },
  'output-dir': { type: 'string' },
} });
if (!['mock', 'real'].includes(values.backend)) throw new Error('--backend must be mock or real');
if (!['pass', 'env'].includes(values.credentials)) throw new Error('--credentials must be pass or env');
if (values.backend === 'real' && values.credentials === 'pass' && !values['secret-ref']?.startsWith('pass://')) {
  throw new Error('Use --secret-ref pass://vault/item/field for a live run.');
}
if (values.backend === 'real' && values.credentials === 'env' && !process.env.TYPESAFE_API_KEY) {
  throw new Error('--credentials env requires TYPESAFE_API_KEY');
}
const runId = values['run-id'] ?? randomUUID();
if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(runId)) throw new Error('Invalid run ID');
const runDir = values['output-dir'] ? path.resolve(values['output-dir']) : path.join(here, 'runs', runId);
const env = { ...process.env, JEV_RUN_ID: runId, JEV_RUN_DIR: runDir,
  JEV_CREDENTIALS: values.credentials,
  JEV_BACKEND: values.backend, JEV_CONTRACT: path.resolve(values.contract),
  JEV_MOCK_ANSWERS: path.resolve(values['mock-answers']), JEV_SECRET_REF: values['secret-ref'] ?? '' };
delete env.JEV_CONTRACT_SNAPSHOT;
const child = spawnSync(process.execPath, [path.join(here, 'node_modules/@playwright/test/cli.js'),
  'test', '--config', path.join(here, 'playwright.config.ts')], { cwd: here, env, stdio: 'inherit' });
// The jev reporter reconciles, checks consistency and writes the viewer when
// the run ends; a failed reconcile fails the Playwright run.
console.log(`${child.status === 0 ? 'PASS' : 'FAIL'} — artifacts: ${runDir}`);
process.exitCode = child.status ?? 1;
