import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { metaOf, withAcceptedAtStart, type AcpTraceFixture } from './acpTraceProtocol';

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

/**
 * CIT-357: Part 5's first pair. #117's review takes two lessons in one session.
 * The second opens exactly where the first ends: the first's solved frames
 * verbatim, and, declared in the data, the one probe its learner accepted.
 * Navigating in and entering directly both start from that declaration.
 */
describe('part 5: #117 continued', () => {
  const chapter = '../content/tutorial/part-5/can-an-upload-read-a-private-file/';
  const trace = (lesson: string, kind: '_files' | '_solution') =>
    JSON.parse(readFileSync(new URL(`${chapter}${lesson}/${kind}/acp-trace.json`, import.meta.url), 'utf8')) as AcpTraceFixture;
  const first = '1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one';
  const second = '2-can-the-check-tell-a-real-block-from-a-generic-crash';
  const probesOf = (fixture: AcpTraceFixture) =>
    fixture.frames.flatMap((frame) => (metaOf(frame.envelope) as { probes?: { question: string }[] } | undefined)?.probes ?? []);

  it('the first lesson offers one probe and ends with it answered', () => {
    expect(trace(first, '_files').frames).toHaveLength(1);
    const solved = trace(first, '_solution');
    expect(solved.nextTurn).toBeNull();
    expect(probesOf(solved).map((probe) => probe.question)).toEqual(['Does the check fail when a read of the private file is forged?']);
  });

  it('the second opens on the first solved frames, that probe accepted', () => {
    const ended = trace(first, '_solution');
    const opens = trace(second, '_files');
    expect(opens.frames).toEqual(ended.frames);
    const review = ended.frames[0].provenance?.recordingId as string;
    expect(opens.acceptedAtStart).toEqual({ [review]: probesOf(ended).map((_, index) => index) });
    expect(opens.nextTurn).not.toBeNull();
  });

  it("the second's Solve continues the same session: one more reply, the start kept", () => {
    const opens = trace(second, '_files');
    const solved = trace(second, '_solution');
    expect(solved.frames.slice(0, opens.frames.length)).toEqual(opens.frames);
    expect(solved.frames).toHaveLength(opens.frames.length + 1);
    expect(solved.frames.at(-1)?.actor).toBe('agent');
    expect(solved.acceptedAtStart).toEqual(opens.acceptedAtStart);
    expect(solved.nextTurn).toBeNull();
    expect(probesOf(solved)[probesOf(opens).length].question).toBe('Does the check fail when the block is a generic crash?');
  });
});

describe('withAcceptedAtStart', () => {
  const start = { 'review#0': [0] };
  it('a learner who skipped the accept still starts where the lesson before ended', () => {
    expect(withAcceptedAtStart(start, {})).toEqual({ 'review#0': [0] });
  });
  it("keeps what the learner accepted beyond the start, in the learner's order", () => {
    expect(withAcceptedAtStart(start, { 'review#0': [2, 0, 1], other: [3] })).toEqual({ 'review#0': [0, 2, 1], other: [3] });
  });
  it('no declared start leaves the choices as they are', () => {
    expect(withAcceptedAtStart(undefined, { other: [1] })).toEqual({ other: [1] });
  });
});
