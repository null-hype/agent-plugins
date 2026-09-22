import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The one spec in src/lib that is deliberately NOT vendored into a
 * lesson's `_files`: it is about the vendoring itself, and inside a
 * WebContainer there is no `src/lib` to compare against.
 *
 * Chapter 3's lessons run their axioms in a WebContainer, which is a
 * self-contained project -- it cannot import across the `_files`
 * boundary, so every module a lesson runs exists twice: once here, where
 * tutorial-app's own `npm test` exercises it, and once under `_files`,
 * where the reader does. Two copies of the same code with no check
 * between them is exactly the drift this chapter's lessons are about,
 * and it bit this lesson once during authoring: `_files` was copied,
 * `src/lib` was then fixed, and the lesson kept running the old spec
 * while the repo's suite was green.
 *
 * Scope, stated honestly: this covers chapter 3 lesson 5 only. Lessons 1
 * through 4 vendored their copies before this check existed and have
 * since drifted in prose on purpose (lesson 2's `ledgerCheckAccess.ts`
 * documents only the specs that lesson runs, for instance), so bringing
 * them under it would mean rewriting their snapshots, not fixing a bug.
 * It also cannot reach the files vendored from `agent-plugins`
 * (`pkl/Reconcile.pkl`, `pkl/Ledger.pkl`, `worker/*.pkl`) -- those cross
 * a repo boundary, and their own headers carry the re-copy instruction
 * instead.
 */
const LESSON_5_FILES = 'src/content/tutorial/part-1/chapter-3/lesson-5/_files';
const LESSON_5_SOLUTION = 'src/content/tutorial/part-1/chapter-3/lesson-5/_solution';

/**
 * Every supporting module lesson 5 still vendors. Its one-file Warm Log
 * exercise has a lesson-local spec and is checked separately below.
 */
const VENDORED = [
  'axioms.ts',
  'toHaveVerdict.ts',
  'reconcileCheck.ts',
  'reconcileGolden.ts',
  'protonObservations.ts',
  'workerFactSource.ts',
  'ledgerCheckAccess.ts',
  'inventoryCheck.ts',
  'grant_state.pkl.ts',
  'inventory.pkl.ts',
  'reconcile.pkl.ts',
];

/**
 * A vendored copy is allowed exactly one difference from its source: the
 * leading `// Vendored from ...` block that says where it came from.
 * Anything past that is drift.
 */
function withoutVendoringHeader(source: string): string {
  const lines = source.split('\n');
  if (!lines[0]?.startsWith('// Vendored from ')) return source;
  let i = 0;
  while (i < lines.length && lines[i].startsWith('//')) i += 1;
  return lines.slice(i).join('\n');
}

/**
 * CIT-203 registered `followerMaze.orderedRouting` in the closed AxiomId union,
 * `axioms` and `worldRef()`. Lesson 5's copies of those two files are
 * deliberately pinned to the registry as it was before that: the follower-maze
 * module lives under src/lesson-farms/ and a WebContainer has no such
 * directory to import it from. This strips exactly those registration lines
 * from src/lib's copy so the comparison still catches every other drift -- and
 * the seam cost is recorded here rather than absorbed silently.
 */
const REGISTRY_FILES = ['axioms.ts', 'toHaveVerdict.ts'];
function withoutFollowerMaze(source: string): string {
  return source
    .replace(" | 'followerMaze.orderedRouting'", '')
    .split('\n')
    .filter((line) => !/followerMaze/i.test(line))
    .join('\n');
}

describe('chapter-3/lesson-5 vendors src/lib without drifting from it', () => {
  it.each(VENDORED)('%s is identical to src/lib/%s', (name) => {
    const vendored = readFileSync(`${LESSON_5_FILES}/${name}`, 'utf8');
    const source = readFileSync(`src/lib/${name}`, 'utf8');

    expect(vendored.startsWith('// Vendored from ')).toBe(true);
    const expected = withoutVendoringHeader(source);
    expect(withoutVendoringHeader(vendored)).toBe(REGISTRY_FILES.includes(name) ? withoutFollowerMaze(expected) : expected);
  });

  it('starts the Warm Log blank and solves it with the exact accepted value', () => {
    const start = readFileSync(`${LESSON_5_FILES}/warm-log.txt`, 'utf8');
    const solved = readFileSync(`${LESSON_5_SOLUTION}/warm-log.txt`, 'utf8');

    expect(start.replace(/\r?\n$/, '')).toBe('');
    expect(solved.replace(/\r?\n$/, '')).toBe('area51:site4:black-budget-vault-access');
  });
});
