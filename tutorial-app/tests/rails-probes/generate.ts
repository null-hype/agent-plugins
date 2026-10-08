// Replaceable presentation of one captured question across two revisions.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateForecastReplay } from '../forecast/generate';
import { capturedPresentation, loadCapturedReplay } from './captures';
import { slugify } from '../../reporters/tutorial';
import { chapter, renderTraces, reproductionDir, solvedFixture, starterFixture, type Layout } from './fixture';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.dirname(APP);
const CHAPTER = path.join(APP, 'src/content/tutorial/part-5/can-an-upload-read-a-private-file');
const FIXTURES = path.join(APP, 'src/stories/fixtures');

/**
 * Every file the S1/S2 replay presentation consists of in `layout`, by its path
 * under the repository root. Only the lessons the module declares have files
 * here: a directory left over from an earlier layout is not one of them (CIT-362).
 */
export function replayPresentation(layout: Layout = 'current', capture = loadCapturedReplay()) {
  const files = new Map<string, string>();
  const put = (file: string, body: string) => files.set(path.relative(REPO, file), body);
  const lessons = chapter(layout);
  // The tutorial reporter names a lesson's directory by its place and title.
  const lessonDirs = lessons.map((lesson, place) => (place + 1) + '-' + slugify(lesson.title));
  for (const key of ['S1', 'S2'] as const) {
    const selected = capturedPresentation(capture, key);
    const answers = new Map<string, string>();
    const probes = path.join(reproductionDir(key), 'probes');
    for (const name of readdirSync(probes)) {
      if (name === 'deleted-trace') continue;
      answers.set('probes/' + name + '/answer.json', readFileSync(path.join(probes, name, 'answer.json'), 'utf8'));
    }
    answers.set('probes/deleted-trace/answer.json', selected.get('probes/deleted-trace/answer.json')!);
    for (const [place, { step }] of lessons.entries()) {
      if (lessons[place].key !== key) continue;
      const traces = renderTraces(key, answers, step, layout);
      put(starterFixture(key, step), traces.starter);
      put(solvedFixture(key, step), traces.solved);
      put(path.join(CHAPTER, lessonDirs[place], '_files/acp-trace.json'), traces.starter);
      put(path.join(CHAPTER, lessonDirs[place], '_solution/acp-trace.json'), traces.solved);
    }
    for (const [rel, body] of selected) put(path.join(reproductionDir(key), rel), body);
    // The state's first lesson reveals these files; later lessons carry them
    // in both their incoming and solved state. Generate every continuity copy.
    const first = lessons.findIndex((lesson) => lesson.key === key);
    for (const [place, name] of lessonDirs.entries()) {
      if (place < first) continue;
      const states = place === first ? ['_solution'] : ['_files', '_solution'];
      for (const state of states) for (const [rel, body] of selected) {
        if (rel.endsWith('/answer.json')) continue;
        put(path.join(CHAPTER, name, state, 'reproduction', key, rel), body);
      }
    }
  }
  return files;
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);

/**
 * Generated files an earlier layout left behind: untracked, ignored, under the
 * chapter or the S1/S2 fixtures, and not in `expected`. Anything else that is
 * out of place (tracked, or not ignored) is not ours to delete, so it is an error.
 */
export function obsoletePresentation(expected: Set<string>) {
  const chapter = path.relative(REPO, CHAPTER);
  const fixtures = path.relative(REPO, FIXTURES);
  const ours = (file: string) => file.startsWith(chapter + '/') || /^rails-matlab-review-[12](-\d+)?\.(starter|solved)\.json$/.test(path.relative(fixtures, file));
  const ignored = git('ls-files', '--others', '--ignored', '--exclude-standard', '--', chapter, fixtures).filter(ours);
  const obsolete = ignored.filter((file) => !expected.has(file));
  const declared = new Set([...expected].filter((file) => file.startsWith(chapter + '/')).map((file) => file.split('/')[chapter.split('/').length]));
  const strays = git('ls-files', '--others', '--exclude-standard', '--', chapter)
    .filter((file) => !declared.has(file.split('/')[chapter.split('/').length]));
  if (strays.length) throw new Error('Undeclared lesson files that are not generated; move or delete them by hand:\n' + strays.join('\n'));
  return obsolete;
}

export function generateReplay(checkExisting = false) {
  const capture = loadCapturedReplay();
  const files = replayPresentation('current', capture);
  for (const [file, body] of files) {
    const absolute = path.join(REPO, file);
    if (checkExisting && existsSync(absolute) && readFileSync(absolute, 'utf8') !== body) throw new Error('Captured replay changes the accepted presentation: ' + absolute);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  // A checkout that generated an earlier layout keeps its ignored files across a
  // pull that renames lessons; remove them so it matches a clean checkout.
  for (const file of obsoletePresentation(new Set(files.keys()))) {
    rmSync(path.join(REPO, file));
    for (let dir = path.dirname(path.join(REPO, file)); dir.startsWith(CHAPTER + '/') && !readdirSync(dir).length; dir = path.dirname(dir)) rmdirSync(dir);
  }
  generateForecastReplay(checkExisting);
  return capture;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--layout');
  if (at >= 0) {
    // `--layout pr152 --output DIR`: write that layout under DIR, by repository
    // path, for the pinned fixture accounting to compare (CIT-362). Touches nothing else.
    const output = process.argv[process.argv.indexOf('--output') + 1];
    if (!output || process.argv.indexOf('--output') < 0) throw new Error('--layout needs --output DIR');
    for (const [file, body] of replayPresentation(process.argv[at + 1] as Layout)) {
      mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
      writeFileSync(path.join(output, file), body);
    }
  } else {
    const capture = generateReplay(process.argv.includes('--check-existing'));
    console.log('Regenerated S1/S2 deleted-trace replay from ' + capture.pin.sha256);
  }
}
