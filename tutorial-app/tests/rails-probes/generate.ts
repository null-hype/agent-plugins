// Replaceable presentation of one captured question across two revisions.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateForecastReplay } from '../forecast/generate';
import { capturedPresentation, loadCapturedReplay } from './captures';
import { slugify } from '../../reporters/tutorial';
import { chapter, renderTraces, reproductionDir, solvedFixture, starterFixture, type Layout } from './fixture';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.dirname(APP);
const CHAPTER = path.join(APP, 'src/content/tutorial/part-5/can-an-upload-read-a-private-file');

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

// What the replay generates in a lesson directory, by its path there. The same
// files .gitignore names; everything else in a lesson is committed.
const GENERATED = /^_(files|solution)\/(acp-trace\.json|reproduction\/S[12]\/(probes\/deleted-trace\/.*|runs\/baseline\/canary-reads\.txt))$/;

/**
 * Remove what an earlier layout generated into lessons `declared` no longer
 * names (CIT-362): a pull that renames a lesson moves its committed files and
 * leaves the generated ones. A directory with anything else left in it is not
 * ours to delete, so that is an error.
 */
export function removeObsoleteLessons(chapterDir: string, declared: readonly string[]) {
  for (const name of readdirSync(chapterDir)) {
    if (!/^\d+-/.test(name) || declared.includes(name)) continue;
    const dir = path.join(chapterDir, name);
    const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)));
    const other = files.filter((file) => !GENERATED.test(file));
    if (other.length) throw new Error(`${dir} is no longer a lesson but holds files the replay did not generate:\n${other.join('\n')}`);
    rmSync(dir, { recursive: true });
  }
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
  removeObsoleteLessons(CHAPTER, chapter().map((lesson, place) => (place + 1) + '-' + slugify(lesson.title)));
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
