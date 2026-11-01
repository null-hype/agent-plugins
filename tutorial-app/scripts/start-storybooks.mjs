import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// One foreground command runs both books. The Codespace lifecycle backgrounds it.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const [config, port] of [['.storybook', '7880'], ['.storybook-tidelands', '7881']]) {
  const child = spawn(process.execPath, [
    'node_modules/storybook/dist/bin/dispatcher.js', 'dev', '-c', config,
    '--port', port, '--host', '0.0.0.0', '--no-open', '--ci', '--exact-port',
  ], { cwd, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
