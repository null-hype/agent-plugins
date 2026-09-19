import { rmSync } from 'node:fs';

/**
 * Runs once per `vitest` process, not per watch-mode rerun -- so
 * evaluations.jsonl holds exactly the current run's records, not an
 * ever-growing history across every save-triggered rerun in watch mode.
 */
export default function setup(): void {
  rmSync('evaluations.jsonl', { force: true });
}
