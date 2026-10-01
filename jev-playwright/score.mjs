import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

export async function score({ id, question, state, model, runDir }) {
  const dir = path.join(runDir, 'questions', id);
  mkdirSync(dir, { recursive: true });
  const write = (name, value) => writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
  // Explicit allowlist: expectations and collector metadata never reach Jev.
  write('state.json', { state });
  write('questions.json', { [id]: question.judge });
  const reason = `goal=jev-playwright-v0; action=jev-score; run=${process.env.JEV_RUN_ID}; question=${id}`;
  const args = [path.resolve(here, '../src/jev/jev'), path.join(dir, 'state.json'),
    '--questions', path.join(dir, 'questions.json'), '--model', model,
    '--request-out', path.join(dir, 'request.json'), '--response-out', path.join(dir, 'response.json')];
  let command = process.env.JEV_PYTHON || path.join(here, '.venv/bin/python');
  let env = { ...process.env };
  const backend = process.env.JEV_BACKEND;
  if (backend === 'mock') {
    const canned = JSON.parse(readFileSync(process.env.JEV_MOCK_ANSWERS, 'utf8'));
    if (!canned || typeof canned !== 'object' || Array.isArray(canned)) throw new Error('Mock answers must be an object');
    const answers = canned.answers ?? canned;
    const selected = Object.hasOwn(answers, id) ? { [id]: answers[id] } : {};
    write('mock-answers.json', canned.answers ? { ...canned, answers: selected } : selected);
    args.push('--backend', 'mock', '--mock-answers', path.join(dir, 'mock-answers.json'));
  } else if (backend === 'real') {
    if (!process.env.JEV_SECRET_REF?.startsWith('pass://')) throw new Error('Live scoring requires --secret-ref pass://vault/item/field');
    // Only forward host session/runtime variables; pass-cli must not resolve
    // unrelated pass:// references from the caller's environment.
    env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'XDG_CONFIG_HOME',
      'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'PROTON_PASS_SESSION_DIR',
      'PROTON_PASS_PERSONAL_ACCESS_TOKEN'].filter(k => process.env[k] !== undefined)
      .map(k => [k, process.env[k]]));
    env.PROTON_PASS_AGENT_REASON = reason;
    env.TYPESAFE_API_KEY = process.env.JEV_SECRET_REF;
    args.unshift('run', '--', command);
    command = 'pass-cli';
  } else {
    throw new Error(`Unknown backend: ${backend}`);
  }
  write('invocation.json', { backend, reason, runId: process.env.JEV_RUN_ID, questionId: id });
  const { stdout, stderr } = await exec(command, args, {
    env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(path.join(dir, 'stderr.txt'), stderr);
  const result = JSON.parse(stdout);
  write('result.json', result);
  return { backend: result.backend, model: result.model, probability: result.probabilities[id], reason };
}
