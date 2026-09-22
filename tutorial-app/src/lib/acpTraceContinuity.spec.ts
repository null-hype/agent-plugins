import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AcpTraceFixture } from './acpTraceProtocol';

/**
 * CIT-247: TutorialKit resolves each lesson's `_files`/`_solution` fixture
 * independently (`@tutorialkit/astro`'s content loader reads them straight
 * from that lesson's own directory) -- there is no built-in mechanism that
 * carries a solved lesson's state into the next one. "Lesson 2 starts from
 * lesson 1's solved state" is therefore a fact about these two committed
 * JSON files, not something TutorialKit enforces on its own; this spec is
 * the mechanical proof; there is no other test in this repo that would
 * catch the two fixtures drifting apart.
 */

const lesson1SolutionPath = new URL(
  '../content/tutorial/part-2/chapter-1/lesson-1/_solution/acp-trace.json',
  import.meta.url,
);
const lesson2FilesPath = new URL(
  '../content/tutorial/part-2/chapter-1/lesson-2/_files/acp-trace.json',
  import.meta.url,
);

function readFixture(path: URL): AcpTraceFixture {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('lesson-2 continuity', () => {
  it('starts from lesson-1 solved frames verbatim, plus its own pending turn', () => {
    const lesson1Solution = readFixture(lesson1SolutionPath);
    const lesson2Files = readFixture(lesson2FilesPath);

    expect(lesson1Solution.nextTurn).toBeNull();
    expect(lesson2Files.frames.slice(0, lesson1Solution.frames.length)).toEqual(lesson1Solution.frames);
    expect(lesson2Files.frames.length).toBeGreaterThan(lesson1Solution.frames.length);
    expect(lesson2Files.nextTurn).not.toBeNull();
  });

  it('lesson-2 solved carries the same prefix, plus the new turn resolved', () => {
    const lesson2Files = readFixture(lesson2FilesPath);
    const lesson2Solution = readFixture(
      new URL('../content/tutorial/part-2/chapter-1/lesson-2/_solution/acp-trace.json', import.meta.url),
    );

    expect(lesson2Solution.frames.slice(0, lesson2Files.frames.length)).toEqual(lesson2Files.frames);
    expect(lesson2Solution.nextTurn).toBeNull();
  });
});
