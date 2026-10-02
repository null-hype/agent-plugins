// Host entry point: Dagger owns Playwright, scoring, and reconciliation.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.join(here, 'dagger');
const { values } = parseArgs({ options: {
  backend: { type: 'string', default: 'mock' },
  'secret-ref': { type: 'string' },
  'mock-answers': { type: 'string', default: 'fixtures/answers.json' },
} });
if (!['mock', 'real'].includes(values.backend)) throw new Error('--backend must be mock or real');
if (values.backend === 'real' && !values['secret-ref']?.startsWith('pass://')) {
  throw new Error('Live runs require --secret-ref pass://vault/item/field');
}
const runId = randomUUID();
const output = path.join(here, 'runs', runId);
const base = ['--silent', '--mod', moduleDir, 'call'];
const execute = (command, args, env, capture = false) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: moduleDir, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  let stdout = '';
  if (capture) child.stdout.on('data', chunk => { stdout += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} exited ${code}`)));
});
const args = [...base, 'run', '--harness', here, '--client', path.resolve(here, '../src/jev'),
  '--run-id', runId, '--backend', values.backend, '--mock-answers', values['mock-answers'],
  'artifacts', 'export', '--path', output];
let command = 'dagger';
let env = { ...process.env };
if (values.backend === 'real') {
  // Purpose comes from the outer module before any secret is resolved.
  const reason = await execute('dagger', [...base, 'reason', '--run-id', runId], env, true);
  env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'XDG_CONFIG_HOME',
    'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'PROTON_PASS_SESSION_DIR',
    'PROTON_PASS_PERSONAL_ACCESS_TOKEN'].filter(k => process.env[k] !== undefined)
    .map(k => [k, process.env[k]]));
  env.PROTON_PASS_AGENT_REASON = reason;
  env.TYPESAFE_API_KEY = values['secret-ref'];
  // Explicit secret binding avoids changing the user's .env. The equivalent
  // optional local default is shown in dagger/.env.example.
  args.splice(args.indexOf('artifacts'), 0, '--token', 'env://TYPESAFE_API_KEY');
  args.unshift('run', '--', command);
  command = 'pass-cli';
}
await execute(command, args, env);
const code = JSON.parse(readFileSync(path.join(output, 'exit-code.json'), 'utf8'));
console.log(`${code === 0 ? 'PASS' : 'FAIL'} — artifacts: ${output}`);
process.exitCode = code;
