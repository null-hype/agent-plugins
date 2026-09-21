import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import {
  classifyAttachment,
  compileTutorialTest,
  groupAttachmentsByStepIndex,
  isTutorialTest,
  reduceStepAttachments,
  slugify,
  topLevelSteps,
} from './tutorial';

function step(overrides: Partial<TestStep> & Pick<TestStep, 'title'>): TestStep {
  return {
    category: 'test.step',
    duration: 1,
    attachments: [],
    steps: [],
    titlePath: () => [],
    annotations: [],
    startTime: new Date(0),
    ...overrides,
  } as TestStep;
}

function attachment(name: string, contentType: string, text: string) {
  return { name, contentType, body: Buffer.from(text, 'utf8') };
}

describe('slugify', () => {
  it('lowercases, hyphenates, and trims punctuation', () => {
    expect(slugify('area51 booking')).toBe('area51-booking');
    expect(slugify('  Reason does NOT compile!  ')).toBe('reason-does-not-compile');
  });
});

describe('isTutorialTest', () => {
  it('is true only when the @tutorial tag is present', () => {
    expect(isTutorialTest({ tags: ['@tutorial'] })).toBe(true);
    expect(isTutorialTest({ tags: ['@smoke', '@tutorial'] })).toBe(true);
    expect(isTutorialTest({ tags: [] })).toBe(false);
    expect(isTutorialTest({ tags: ['@smoke'] })).toBe(false);
  });
});

describe('topLevelSteps', () => {
  it('keeps only top-level test.step entries, dropping hooks/expects/fixtures and nested steps', () => {
    const inner = step({ title: 'inner expect', category: 'expect' });
    const nested = step({ title: 'nested step', category: 'test.step', parent: step({ title: 'a' }), steps: [] });
    const a = step({ title: 'a', category: 'test.step', steps: [nested] });
    const hook = step({ title: 'beforeEach', category: 'hook' });
    const b = step({ title: 'b', category: 'test.step' });

    const result: Pick<TestResult, 'steps'> = { steps: [hook, a, inner, nested, b] };

    expect(topLevelSteps(result).map((s) => s.title)).toEqual(['a', 'b']);
  });
});

describe('classifyAttachment', () => {
  it('routes tutorial:file/, tutorial:prose, and image attachments; ignores everything else', () => {
    const body = Buffer.from('hi');
    expect(classifyAttachment('file/reason.txt', 'text/plain', body)).toMatchObject({ kind: 'file', path: 'reason.txt' });
    expect(classifyAttachment('prose', 'text/markdown', body)).toMatchObject({ kind: 'prose' });
    expect(classifyAttachment('frame', 'image/png', body)).toMatchObject({ kind: 'screenshot' });
    expect(classifyAttachment('unrelated', 'application/zip', body)).toMatchObject({ kind: 'ignore' });
  });
});

describe('groupAttachmentsByStepIndex / reduceStepAttachments', () => {
  it('groups TestResult.attachments by the tutorial:<n>: prefix, ignoring un-prefixed attachments', () => {
    const attachments = [
      attachment('trace', 'application/zip', 'not ours'),
      attachment('tutorial:1:file/reason.txt', 'text/plain', 'Scheduled facility inspection, badge #A51-7'),
      attachment('tutorial:1:prose', 'text/markdown', 'Type a real reason.'),
      attachment('tutorial:1:frame', 'image/png', 'pretend-png'),
      attachment('tutorial:2:file/decision.ts', 'text/plain', "let decision: 'approve' | 'deny';"),
    ];

    const byStep = groupAttachmentsByStepIndex(attachments);
    expect([...byStep.keys()].sort()).toEqual([1, 2]);

    const step1 = reduceStepAttachments(byStep.get(1)!);
    expect(step1.files).toEqual({ 'reason.txt': Buffer.from('Scheduled facility inspection, badge #A51-7') });
    expect(step1.prose).toBe('Type a real reason.');
    expect(step1.screenshot?.toString()).toBe('pretend-png');

    const step2 = reduceStepAttachments(byStep.get(2)!);
    expect(step2.files).toEqual({ 'decision.ts': Buffer.from("let decision: 'approve' | 'deny';") });
    expect(step2.prose).toBeNull();
  });
});

describe('compileTutorialTest', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes one lesson per top-level step, with cumulative _files/_solution', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tutorial-reporter-'));

    const s1 = step({ title: 'reason does not compile' });
    const s2 = step({ title: 'decision is typed' });

    const test: Pick<TestCase, 'title' | 'tags'> = { title: 'area51 booking', tags: ['@tutorial'] };
    const result: Pick<TestResult, 'status' | 'steps' | 'attachments'> = {
      status: 'passed',
      steps: [s1, s2],
      attachments: [
        attachment('tutorial:1:file/reason.txt', 'text/plain', 'a valid reason'),
        attachment('tutorial:1:prose', 'text/markdown', 'Fix the reason.'),
        attachment('tutorial:2:file/decision.ts', 'text/plain', "let decision: 'approve' | 'deny';"),
      ],
    };

    compileTutorialTest(test, result, dir);

    const chapterDir = path.join(dir, 'area51-booking');
    expect(readdirSync(chapterDir).sort()).toEqual(['1-reason-does-not-compile', '2-decision-is-typed', 'meta.md'].sort());

    const meta = readFileSync(path.join(chapterDir, 'meta.md'), 'utf8');
    expect(meta).toContain('type: chapter');
    expect(meta).toContain('title: area51 booking');

    // Lesson 1: _files is the empty starting state, _solution has reason.txt.
    const lesson1 = path.join(chapterDir, '1-reason-does-not-compile');
    expect(readdirSync(path.join(lesson1, '_files'))).toEqual([]);
    expect(readFileSync(path.join(lesson1, '_solution', 'reason.txt'), 'utf8')).toBe('a valid reason');
    expect(readFileSync(path.join(lesson1, 'content.mdx'), 'utf8')).toContain('Fix the reason.');

    // Lesson 2: _files carries lesson 1's solved state forward; _solution adds decision.ts.
    const lesson2 = path.join(chapterDir, '2-decision-is-typed');
    expect(readFileSync(path.join(lesson2, '_files', 'reason.txt'), 'utf8')).toBe('a valid reason');
    expect(readFileSync(path.join(lesson2, '_solution', 'reason.txt'), 'utf8')).toBe('a valid reason');
    expect(readFileSync(path.join(lesson2, '_solution', 'decision.ts'), 'utf8')).toBe("let decision: 'approve' | 'deny';");
  });

  it('is byte-identical across repeated compiles of the same test result', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'tutorial-reporter-'));
    const other = mkdtempSync(path.join(tmpdir(), 'tutorial-reporter-'));

    const s1 = step({ title: 'runnable appears' });
    const test: Pick<TestCase, 'title' | 'tags'> = { title: 'area51 booking', tags: ['@tutorial'] };
    const result: Pick<TestResult, 'status' | 'steps' | 'attachments'> = {
      status: 'passed',
      steps: [s1],
      attachments: [attachment('tutorial:1:file/booking-confirmation.txt', 'text/plain', 'CONFIRMED: area51 booking')],
    };

    compileTutorialTest(test, result, dir);
    compileTutorialTest(test, result, other);

    const readTree = (root: string) =>
      readdirSync(path.join(root, 'area51-booking', '1-runnable-appears', '_solution')).map((name) =>
        readFileSync(path.join(root, 'area51-booking', '1-runnable-appears', '_solution', name)),
      );

    expect(readTree(dir)).toEqual(readTree(other));
    rmSync(other, { recursive: true, force: true });
  });
});
