import type { FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { codeHash } from './inputs.mjs';

// A run starts: make its directory, record the contract it is asked of before
// any worker reads it, and record the code it is asked of, so a later reader
// can tell whether the run still describes the files on disk.
export default function globalSetup(config: FullConfig) {
  const runDir = process.env.JEV_RUN_DIR!;
  const snapshot = process.env.JEV_CONTRACT_SNAPSHOT!;
  mkdirSync(runDir, { recursive: true });
  mkdirSync(path.dirname(snapshot), { recursive: true });
  writeFileSync(snapshot, JSON.stringify(config.metadata.experiment, null, 2) + '\n');
  writeFileSync(path.join(runDir, 'inputs.json'), JSON.stringify({
    code: codeHash(), backend: process.env.JEV_BACKEND,
  }, null, 2) + '\n');
}
