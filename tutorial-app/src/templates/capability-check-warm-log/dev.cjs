const { spawn } = require('node:child_process');

const children = [
  spawn(process.execPath, ['node_modules/vitest/vitest.mjs', '--watch'], { stdio: 'inherit' }),
  spawn(process.execPath, ['server.cjs'], { stdio: 'inherit' }),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) {
    return;
  }

  stopping = true;

  for (const child of children) {
    child.kill();
  }

  process.exitCode = exitCode;
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });

  child.on('exit', (code, signal) => {
    if (!stopping) {
      stop(signal ? 1 : (code ?? 0));
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
