import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

// CIT-235 spike: compiles a passing `@tutorial`-tagged Playwright test into
// TutorialKit lessons -- one lesson per top-level test.step, `_files` the
// state before the step, `_solution` the state after. See
// reporters/README.md for the full contract this implements, including why
// attachment names carry a `tutorial:<step-index>:` prefix.

export interface TutorialReporterOptions {
  outDir: string;
}

export const TUTORIAL_TAG = '@tutorial';

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isTutorialTest(test: Pick<TestCase, 'tags'>): boolean {
  return test.tags.includes(TUTORIAL_TAG);
}

/**
 * `result.steps` is a flat list of every step (steps, expects, fixtures,
 * hooks, nested test.step calls all included), each carrying its own
 * `.parent`. A top-level lesson-worthy step is a `test.step` call with no
 * parent -- excluding it also drops everything nested *inside* a
 * test.step, which is deliberate: nested steps are out of scope for this
 * spike (see CIT-235's "Out" list).
 */
export function topLevelSteps(result: Pick<TestResult, 'steps'>): TestStep[] {
  return result.steps.filter((step) => step.category === 'test.step' && !step.parent);
}

type RawAttachment = { name: string; contentType: string; body?: Buffer; path?: string };

type ClassifiedAttachment =
  | { kind: 'file'; path: string; body: Buffer }
  | { kind: 'beforeFile'; path: string; body: Buffer }
  | { kind: 'prose'; body: Buffer }
  | { kind: 'screenshot'; body: Buffer }
  | { kind: 'ignore' };

const FILE_PREFIX = 'file/';
const BEFORE_FILE_PREFIX = 'before/file/';
const PROSE_NAME = 'prose';

// Playwright 1.59.1's reporter API *declares* TestStep.attachments (see
// node_modules/playwright/types/testReporter.d.ts), but at runtime it is
// always empty -- everything a testInfo.attach() call makes inside a
// test.step lands flat on TestResult.attachments instead, in call order,
// with no back-reference to which step made it. tests/area51-booking.spec.ts
// works around this the way CIT-235 anticipated: it prefixes every
// tutorial:* attachment name with the 1-based index of the step it belongs
// to (`tutorial:1:file/reason.txt`), and this reporter groups by that index
// rather than by TestStep.attachments. If a future Playwright version
// starts populating TestStep.attachments for real, this prefix scheme still
// works (it's just no longer load-bearing) -- no need to change the test.
const INDEXED_NAME = /^tutorial:(\d+):(.+)$/;

function readAttachmentBody(attachment: RawAttachment): Buffer {
  if (attachment.body) return attachment.body;
  if (attachment.path) return readFileSync(attachment.path);
  throw new Error(`tutorial attachment "${attachment.name}" has neither body nor path`);
}

export function classifyAttachment(name: string, contentType: string, body: Buffer): ClassifiedAttachment {
  if (name.startsWith(FILE_PREFIX)) {
    return { kind: 'file', path: name.slice(FILE_PREFIX.length), body };
  }
  if (name.startsWith(BEFORE_FILE_PREFIX)) {
    return { kind: 'beforeFile', path: name.slice(BEFORE_FILE_PREFIX.length), body };
  }
  if (name === PROSE_NAME) {
    return { kind: 'prose', body };
  }
  if (contentType.startsWith('image/')) {
    return { kind: 'screenshot', body };
  }
  return { kind: 'ignore' };
}

/**
 * Groups TestResult.attachments by the step index encoded in their name
 * (`tutorial:<n>:...`), 1-based to match the order top-level steps are
 * enumerated in. Attachments with no `tutorial:` name at all (Playwright's
 * own trace/video attachments, say) are ignored here, not misfiled into
 * step 0.
 */
export function groupAttachmentsByStepIndex(attachments: readonly RawAttachment[]): Map<number, ClassifiedAttachment[]> {
  const byIndex = new Map<number, ClassifiedAttachment[]>();
  for (const attachment of attachments) {
    const match = INDEXED_NAME.exec(attachment.name);
    if (!match) continue;
    const index = Number(match[1]);
    const classified = classifyAttachment(match[2], attachment.contentType, readAttachmentBody(attachment));
    if (classified.kind === 'ignore') continue;
    const bucket = byIndex.get(index) ?? [];
    bucket.push(classified);
    byIndex.set(index, bucket);
  }
  return byIndex;
}

interface StepAttachments {
  /** State at the start of the step (`tutorial:<n>:before/file/<path>`): becomes `_files`. */
  beforeFiles: Record<string, Buffer>;
  /** State at the end of the step (`tutorial:<n>:file/<path>`), merged onto the previous step's end state. */
  files: Record<string, Buffer>;
  prose: string | null;
  screenshot: Buffer | null;
}

export function reduceStepAttachments(classified: readonly ClassifiedAttachment[]): StepAttachments {
  const beforeFiles: Record<string, Buffer> = {};
  const files: Record<string, Buffer> = {};
  let prose: string | null = null;
  let screenshot: Buffer | null = null;

  for (const item of classified) {
    if (item.kind === 'file') files[item.path] = item.body;
    else if (item.kind === 'beforeFile') beforeFiles[item.path] = item.body;
    else if (item.kind === 'prose') prose = item.body.toString('utf8');
    else if (item.kind === 'screenshot') screenshot = item.body;
  }

  return { beforeFiles, files, prose, screenshot };
}

function writeFrontmatter(filePath: string, frontmatter: Record<string, unknown>, body = ''): void {
  const yamlBlock = yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd();
  writeFileSync(filePath, `---\n${yamlBlock}\n---\n${body}`);
}

function writeFileTree(dir: string, files: Record<string, Buffer>): void {
  mkdirSync(dir, { recursive: true });
  for (const [relativePath, body] of Object.entries(files)) {
    const fullPath = path.join(dir, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, body);
  }
}

function lessonBody(prose: string | null, hasScreenshot: boolean): string {
  const parts: string[] = [];
  if (prose) parts.push(prose.trimEnd());
  if (hasScreenshot) parts.push('![Frame](./frame.png)');
  return parts.length > 0 ? `\n${parts.join('\n\n')}\n` : '\n';
}

/**
 * Thrown when a step's declared starting state disagrees with the previous
 * step's end state. The lessons are a chain -- Solve on lesson n-1 must land
 * exactly where lesson n starts -- so a gap means the storyboard (or the
 * story args it navigates to) has two sources of truth that drifted apart.
 */
export class ContinuityError extends Error {
  constructor(public readonly problems: string[]) {
    super(`tutorial state continuity broken:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ContinuityError';
  }
}

const excerpt = (body: Buffer) => JSON.stringify(body.toString('utf8').slice(0, 60));

/** Human-readable differences between two file sets; empty when identical. */
export function diffFileSets(
  expected: Record<string, Buffer>,
  actual: Record<string, Buffer>,
  labels: { expected: string; actual: string },
): string[] {
  const problems: string[] = [];
  for (const file of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    const inExpected = file in expected;
    const inActual = file in actual;
    if (inExpected && !inActual) problems.push(`${file}: in ${labels.expected} but missing from ${labels.actual}`);
    else if (!inExpected && inActual) problems.push(`${file}: in ${labels.actual} but missing from ${labels.expected}`);
    else if (!expected[file].equals(actual[file])) {
      problems.push(`${file}: differs -- ${labels.expected} ${excerpt(expected[file])} vs ${labels.actual} ${excerpt(actual[file])}`);
    }
  }
  return problems;
}

interface PlannedLesson {
  stepIndex: number;
  title: string;
  before: Record<string, Buffer>;
  after: Record<string, Buffer>;
  focus: string | undefined;
  prose: string | null;
  screenshot: Buffer | null;
}

/**
 * Pure planning pass: resolves every lesson's before/after and enforces
 * continuity, touching no disk, so a broken storyboard leaves the existing
 * output untouched instead of half-rewriting it.
 *
 * `after(n)` is `after(n-1)` merged with step n's `file/` attachments (the
 * contract's "cumulative"). `before(n)` is whatever the test attached under
 * `before/file/` at the start of step n -- never inferred from `after(n-1)`,
 * because inferring it is exactly the assumption this check exists to
 * replace. A step with no `before/` attachments therefore declares an empty
 * start, which is only continuous for the first step.
 */
export function planLessons(steps: readonly TestStep[], attachmentsByStep: Map<number, ClassifiedAttachment[]>): PlannedLesson[] {
  const problems: string[] = [];
  const lessons: PlannedLesson[] = [];
  let previousAfter: Record<string, Buffer> = {};

  steps.forEach((step, i) => {
    const stepIndex = i + 1;
    const { beforeFiles, files, prose, screenshot } = reduceStepAttachments(attachmentsByStep.get(stepIndex) ?? []);
    const after = { ...previousAfter, ...files };

    if (i > 0) {
      const previous = steps[i - 1];
      const labels = { expected: `end of step ${stepIndex - 1} ("${previous.title}")`, actual: `start of step ${stepIndex} ("${step.title}")` };
      problems.push(...diffFileSets(previousAfter, beforeFiles, labels));
    }

    // Focus a file this step changes *and that already exists at the start*:
    // TutorialKit can only open what is in `_files`, so a file the step
    // merely introduces (it appears on Solve) must not be the focus target --
    // that opened an empty editor before. No such file -> no `focus`.
    const focus = Object.keys(files)
      .sort()
      .find((file) => file in beforeFiles && !beforeFiles[file].equals(files[file]));

    lessons.push({ stepIndex, title: step.title, before: beforeFiles, after, focus, prose, screenshot });
    previousAfter = after;
  });

  if (problems.length > 0) throw new ContinuityError(problems);
  return lessons;
}

export function compileTutorialTest(
  test: Pick<TestCase, 'title' | 'tags'>,
  result: Pick<TestResult, 'status' | 'steps' | 'attachments'>,
  outDir: string,
): void {
  const lessons = planLessons(topLevelSteps(result), groupAttachmentsByStepIndex(result.attachments));
  const chapterDir = path.join(outDir, slugify(test.title));

  // Every compile starts from a clean slate: a stale lesson left behind by
  // a step that got renamed or removed would otherwise linger forever.
  if (existsSync(chapterDir)) rmSync(chapterDir, { recursive: true, force: true });
  mkdirSync(chapterDir, { recursive: true });

  writeFrontmatter(path.join(chapterDir, 'meta.md'), { type: 'chapter', title: test.title });

  for (const lesson of lessons) {
    const lessonDir = path.join(chapterDir, `${lesson.stepIndex}-${slugify(lesson.title)}`);
    writeFileTree(path.join(lessonDir, '_files'), lesson.before);
    writeFileTree(path.join(lessonDir, '_solution'), lesson.after);

    if (lesson.screenshot) writeFileSync(path.join(lessonDir, 'frame.png'), lesson.screenshot);

    writeFrontmatter(
      path.join(lessonDir, 'content.mdx'),
      {
        type: 'lesson',
        title: lesson.title,
        template: 'default',
        ...(lesson.focus ? { focus: `/${lesson.focus}` } : {}),
        terminal: false,
        editor: { fileTree: true },
        previews: false,
      },
      lessonBody(lesson.prose, lesson.screenshot !== null),
    );
  }
}

export default class TutorialReporter implements Reporter {
  private readonly outDir: string;
  private brokenStoryboards = 0;

  constructor(options: TutorialReporterOptions) {
    if (!options?.outDir) {
      throw new Error('tutorial reporter requires an `outDir` option (the tutorial part directory to write chapters into)');
    }
    this.outDir = options.outDir;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!isTutorialTest(test)) return;

    if (result.status !== 'passed') {
      console.warn(
        `[tutorial-reporter] skipping "${test.title}": status is "${result.status}", not "passed" -- a failing @tutorial test is a broken storyboard, not a lesson`,
      );
      return;
    }

    const steps = topLevelSteps(result);
    if (steps.length === 0) {
      console.warn(`[tutorial-reporter] skipping "${test.title}": no top-level test.step entries to compile`);
      return;
    }

    try {
      compileTutorialTest(test, result, this.outDir);
    } catch (error) {
      if (!(error instanceof ContinuityError)) throw error;
      this.brokenStoryboards += 1;
      console.error(`[tutorial-reporter] refusing to compile "${test.title}": ${error.message}`);
      return;
    }
    console.log(`[tutorial-reporter] compiled ${steps.length} lesson(s) from "${test.title}" into ${this.outDir}`);
  }

  // A continuity break is a real failure, not a warning: the test itself
  // passed, but the storyboard it describes is not a valid lesson chain, so
  // the run must exit non-zero rather than look green with stale output.
  onEnd(): { status: 'failed' } | undefined {
    return this.brokenStoryboards > 0 ? { status: 'failed' } : undefined;
  }
}
