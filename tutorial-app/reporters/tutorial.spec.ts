import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import {
  ContinuityError,
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
    expect(classifyAttachment('before/file/reason.txt', 'text/plain', body)).toMatchObject({ kind: 'beforeFile', path: 'reason.txt' });
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

/** Every file under `root`, relative path -> bytes, so whole trees can be compared. */
function readTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(root, full)] = readFileSync(full).toString('base64');
    }
  };
  walk(root);
  return out;
}

const test: Pick<TestCase, 'title' | 'tags'> = { title: 'area51 booking', tags: ['@tutorial'] };
const passed = (steps: TestStep[], attachments: ReturnType<typeof attachment>[]) =>
  ({ status: 'passed', steps, attachments }) as Pick<TestResult, 'status' | 'steps' | 'attachments'>;

// A continuous two-step storyboard: step 2 starts exactly where step 1 ended.
const continuousAttachments = () => [
  attachment('tutorial:1:before/file/reason.txt', 'text/plain', ''),
  attachment('tutorial:1:before/file/decision.ts', 'text/plain', 'let decision: any;'),
  attachment('tutorial:1:file/reason.txt', 'text/plain', 'a valid reason'),
  attachment('tutorial:1:file/decision.ts', 'text/plain', 'let decision: any;'),
  attachment('tutorial:1:prose', 'text/markdown', 'Fix the reason.'),
  attachment('tutorial:2:before/file/reason.txt', 'text/plain', 'a valid reason'),
  attachment('tutorial:2:before/file/decision.ts', 'text/plain', 'let decision: any;'),
  attachment('tutorial:2:file/reason.txt', 'text/plain', 'a valid reason'),
  attachment('tutorial:2:file/decision.ts', 'text/plain', "let decision: 'approve' | 'deny';"),
];

describe('compileTutorialTest', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(path.join(tmpdir(), 'tutorial-reporter-'));
    dirs.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const steps = () => [step({ title: 'reason does not compile' }), step({ title: 'decision is typed' })];

  it('allows runtime metadata and lets explicit focus override the inferred file', () => {
    const dir = tmp();
    const attachments = continuousAttachments();
    attachments.push(attachment('tutorial:1:meta', 'application/json', JSON.stringify({ template: 'follower-maze', focus: '/decision.ts', previews: [[4173, 'Follower Maze']], editor: false })));
    compileTutorialTest(test, passed(steps(), attachments), dir);
    const content = readFileSync(path.join(dir, 'area51-booking/1-reason-does-not-compile/content.mdx'), 'utf8');
    expect(content).toContain('template: follower-maze');
    expect(content).toContain('focus: /decision.ts');
    expect(content).not.toContain('focus: /reason.txt');
    expect(content).toContain('editor: false');
    // No metadata leaks into the following lesson.
    expect(readFileSync(path.join(dir, 'area51-booking/2-decision-is-typed/content.mdx'), 'utf8')).toContain('template: default');
  });

  it('rejects metadata that changes lesson identity before touching existing output', () => {
    const dir = tmp();
    compileTutorialTest(test, passed(steps(), continuousAttachments()), dir);
    const before = readTree(dir);
    const attachments = continuousAttachments();
    attachments.push(attachment('tutorial:1:meta', 'application/json', '{"title":"replacement"}'));
    expect(() => compileTutorialTest(test, passed(steps(), attachments), dir)).toThrow('runtime/display');
    expect(readTree(dir)).toEqual(before);
  });

  it('writes one lesson per top-level step, with _files from the declared start state and _solution from the end state', () => {
    const dir = tmp();
    compileTutorialTest(test, passed(steps(), continuousAttachments()), dir);

    const chapterDir = path.join(dir, 'area51-booking');
    expect(readdirSync(chapterDir).sort()).toEqual(['1-reason-does-not-compile', '2-decision-is-typed', 'meta.md'].sort());

    const meta = readFileSync(path.join(chapterDir, 'meta.md'), 'utf8');
    expect(meta).toContain('type: chapter');
    expect(meta).toContain('title: area51 booking');

    // Lesson 1 starts with the files the prose talks about, not an empty dir.
    const lesson1 = path.join(chapterDir, '1-reason-does-not-compile');
    expect(readFileSync(path.join(lesson1, '_files', 'reason.txt'), 'utf8')).toBe('');
    expect(readFileSync(path.join(lesson1, '_files', 'decision.ts'), 'utf8')).toBe('let decision: any;');
    expect(readFileSync(path.join(lesson1, '_solution', 'reason.txt'), 'utf8')).toBe('a valid reason');
    expect(readFileSync(path.join(lesson1, 'content.mdx'), 'utf8')).toContain('Fix the reason.');
    // ...and focus points at a file that now exists in _files, the one this step changes.
    expect(readFileSync(path.join(lesson1, 'content.mdx'), 'utf8')).toContain('focus: /reason.txt');

    // Lesson 2: Solve *changes* decision.ts (any -> typed), it doesn't add it.
    const lesson2 = path.join(chapterDir, '2-decision-is-typed');
    expect(readFileSync(path.join(lesson2, '_files', 'decision.ts'), 'utf8')).toBe('let decision: any;');
    expect(readFileSync(path.join(lesson2, '_solution', 'decision.ts'), 'utf8')).toBe("let decision: 'approve' | 'deny';");
    expect(readFileSync(path.join(lesson2, 'content.mdx'), 'utf8')).toContain('focus: /decision.ts');
  });

  it('omits focus when a step only introduces a file, since it is absent from _files', () => {
    const dir = tmp();
    const attachments = [
      attachment('tutorial:1:before/file/a.txt', 'text/plain', 'a'),
      attachment('tutorial:1:file/a.txt', 'text/plain', 'a'),
      attachment('tutorial:1:file/new.txt', 'text/plain', 'new'),
    ];
    compileTutorialTest(test, passed([step({ title: 'adds a file' })], attachments), dir);
    expect(readFileSync(path.join(dir, 'area51-booking', '1-adds-a-file', 'content.mdx'), 'utf8')).not.toContain('focus:');
  });

  it('is byte-identical across repeated compiles: the whole output tree, not one directory', () => {
    const a = tmp();
    const b = tmp();
    compileTutorialTest(test, passed(steps(), [...continuousAttachments(), attachment('tutorial:1:frame', 'image/png', 'png-1')]), a);
    compileTutorialTest(test, passed(steps(), [...continuousAttachments(), attachment('tutorial:1:frame', 'image/png', 'png-1')]), b);

    const treeA = readTree(a);
    expect(Object.keys(treeA).length).toBeGreaterThan(8); // meta + content x2 + _files/_solution + frame
    expect(treeA).toEqual(readTree(b));
  });

  it('fails the compile and writes nothing when a step starts somewhere the previous step did not end', () => {
    const dir = tmp();
    const broken = continuousAttachments().map((a) =>
      // step 2 starts from a *different* reason than step 1 ended with -- the drift CIT-236 exists to catch.
      a.name === 'tutorial:2:before/file/reason.txt' ? attachment(a.name, a.contentType, 'some other reason') : a,
    );

    let thrown: unknown;
    try {
      compileTutorialTest(test, passed(steps(), broken), dir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ContinuityError);
    expect((thrown as ContinuityError).problems).toHaveLength(1);
    expect((thrown as ContinuityError).message).toContain('reason.txt: differs');
    expect((thrown as ContinuityError).message).toContain('end of step 1');
    expect((thrown as ContinuityError).message).toContain('start of step 2');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves previously compiled output untouched when the new storyboard is discontinuous', () => {
    const dir = tmp();
    compileTutorialTest(test, passed(steps(), continuousAttachments()), dir);
    const before = readTree(dir);

    const dropped = continuousAttachments().filter((a) => a.name !== 'tutorial:2:before/file/decision.ts');
    expect(() => compileTutorialTest(test, passed(steps(), dropped), dir)).toThrow(/decision\.ts: in end of step 1.*missing from start of step 2/);
    expect(readTree(dir)).toEqual(before);
  });

  it('treats a missing before/ declaration as an empty start, which is only continuous for step 1', () => {
    const dir = tmp();
    const noBefore = continuousAttachments().filter((a) => !a.name.includes(':before/'));
    expect(() => compileTutorialTest(test, passed(steps(), noBefore), dir)).toThrow(ContinuityError);
    expect(existsSync(path.join(dir, 'area51-booking'))).toBe(false);
  });
});
