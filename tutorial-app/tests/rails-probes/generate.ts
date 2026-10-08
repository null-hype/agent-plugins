// Replaceable presentation of one captured question across two revisions.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateForecastReplay } from '../forecast/generate';
import { capturedPresentation, loadCapturedReplay } from './captures';
import { slugify } from '../../reporters/tutorial';
import { chapter, renderTraces, reproductionDir, solvedFixture, starterFixture } from './fixture';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHAPTER = path.join(APP, 'src/content/tutorial/part-5/can-an-upload-read-a-private-file');
const same = (file: string, bytes: string, check: boolean) => {
  if (check && existsSync(file) && readFileSync(file, 'utf8') !== bytes) throw new Error('Captured replay changes the accepted presentation: ' + file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
};

export function generateReplay(checkExisting = false) {
  const capture = loadCapturedReplay();
  const lessons = chapter();
  const lessonDirs = readdirSync(CHAPTER).filter((name) => /^\d+-/.test(name));
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
      const traces = renderTraces(key, answers, step);
      same(starterFixture(key, step), traces.starter, checkExisting);
      same(solvedFixture(key, step), traces.solved, checkExisting);
      // The tutorial reporter names a lesson's directory by its place and title.
      const lesson = (place + 1) + '-' + slugify(lessons[place].title);
      if (!lessonDirs.includes(lesson)) lessonDirs.push(lesson);
      same(path.join(CHAPTER, lesson, '_files/acp-trace.json'), traces.starter, checkExisting);
      same(path.join(CHAPTER, lesson, '_solution/acp-trace.json'), traces.solved, checkExisting);
    }
    for (const [rel, body] of selected) same(path.join(reproductionDir(key), rel), body, checkExisting);
    // The state's first lesson reveals these files; later lessons carry them
    // in both their incoming and solved state. Generate every continuity copy.
    const first = lessons.findIndex((lesson) => lesson.key === key) + 1;
    for (const name of lessonDirs) {
      const number = Number(name.split('-')[0]);
      if (number < first) continue;
      const states = number === first ? ['_solution'] : ['_files', '_solution'];
      for (const state of states) for (const [rel, body] of selected) {
        if (rel.endsWith('/answer.json')) continue;
        same(path.join(CHAPTER, name, state, 'reproduction', key, rel), body, checkExisting);
      }
    }
  }
  generateForecastReplay(checkExisting);
  return capture;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const capture = generateReplay(process.argv.includes('--check-existing'));
  console.log('Regenerated S1/S2 deleted-trace replay from ' + capture.pin.sha256);
}
