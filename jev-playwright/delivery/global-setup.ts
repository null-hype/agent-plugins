import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A run of the plan starts: an empty ledger of the reasons it gives Pass, and
// the time it started, so retro can tell this run's accesses from earlier ones.
export default function globalSetup() {
  const ledger = process.env.DELIVERY_LEDGER!;
  mkdirSync(path.dirname(ledger), { recursive: true });
  writeFileSync(ledger, '');
  writeFileSync(path.join(path.dirname(ledger), 'started.json'), JSON.stringify({ at: new Date().toISOString() }) + '\n');
}
