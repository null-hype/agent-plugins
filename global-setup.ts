import type { FullConfig } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A run starts: make its directory and record the contract it is asked of,
// before any worker reads it.
export default function globalSetup(config: FullConfig) {
  const snapshot = process.env.JEV_CONTRACT_SNAPSHOT!;
  mkdirSync(process.env.JEV_RUN_DIR!, { recursive: true });
  mkdirSync(path.dirname(snapshot), { recursive: true });
  writeFileSync(snapshot, JSON.stringify(config.metadata.experiment, null, 2) + '\n');
}
