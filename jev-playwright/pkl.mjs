import { execFileSync } from 'node:child_process';

// Evaluate the real Pkl contract before JSON crosses into JavaScript. This is
// a CLI adapter, not a claim that an npm binding exposes a pkl.load function.
export function load(path, properties = {}) {
  const args = ['eval', '--format', 'json'];
  for (const [key, value] of Object.entries(properties)) args.push('-p', `${key}=${value}`);
  args.push(path);
  return JSON.parse(execFileSync(process.env.PKL_BIN || 'pkl', args, {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}
