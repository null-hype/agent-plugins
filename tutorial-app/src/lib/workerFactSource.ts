import { readFileSync } from 'node:fs';

const LESSON_DIR = 'src/content/tutorial/part-1/chapter-3/lesson-5';

/**
 * Reads a worker fact file's text the way
 * capability-spike/reconcile/reconcile.go's `factRoutesThroughGate` does
 * -- off disk, at check time, not from a transcription. That matters
 * here: the file is meant to be edited, and a copy of its text baked
 * into TypeScript would keep reporting the old verdict after the edit.
 *
 * Two layouts, because this file runs in two places:
 *
 * 1. In the lesson's WebContainer, `_files` is laid out at the container
 *    root, so `worker/bypassed_gate.pkl` resolves directly -- and
 *    resolves to whatever the reader (or the Solve button's `_solution`
 *    overlay) most recently wrote.
 * 2. In tutorial-app's own `npm test`, the cwd is the app root and there
 *    is no such file, so it falls through to the lesson's content dir --
 *    `_solution` first and `_files` only after. That order is
 *    deliberate: `_files` holds this lesson's intentionally-broken
 *    starting state, and a repo-side suite that read it would be
 *    asserting the bug. `_solution` is a partial overlay carrying only
 *    the files the exercise changes, so a fact file the reader is not
 *    asked to touch has no copy there and legitimately resolves from
 *    `_files`.
 */
export function readWorkerFactSource(relativePath: string): string {
  const candidates = [
    relativePath,
    `${LESSON_DIR}/_solution/${relativePath}`,
    `${LESSON_DIR}/_files/${relativePath}`,
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      // Try the next layout; only a miss in every one is an error.
    }
  }
  throw new Error(
    `worker fact file "${relativePath}" not found in any known layout (tried: ${candidates.join(', ')})`,
  );
}
