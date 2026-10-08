// Replaceable presentation of one captured question across two revisions.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturedPresentation, loadCapturedReplay } from './captures';
import { renderTraces, reproductionDir, solvedFixture, starterFixture } from './fixture';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHAPTER = path.join(APP, 'src/content/tutorial/part-5/can-an-upload-read-a-private-file');
const same = (file: string, bytes: string, check: boolean) => {
  if (check && existsSync(file) && readFileSync(file, 'utf8') !== bytes) throw new Error('Captured replay changes the accepted presentation: ' + file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
};

export function generateReplay(checkExisting = false) {
  const capture = loadCapturedReplay();
  for (const [index, key] of (['S1', 'S2'] as const).entries()) {
    const selected = capturedPresentation(capture, key);
    const answers = new Map<string, string>();
    const probes = path.join(reproductionDir(key), 'probes');
    for (const name of readdirSync(probes)) {
      if (name === 'deleted-trace') continue;
      answers.set('probes/' + name + '/answer.json', readFileSync(path.join(probes, name, 'answer.json'), 'utf8'));
    }
    answers.set('probes/deleted-trace/answer.json', selected.get('probes/deleted-trace/answer.json')!);
    const traces = renderTraces(key, answers);
    same(starterFixture(key), traces.starter, checkExisting);
    same(solvedFixture(key), traces.solved, checkExisting);
    for (const [rel, body] of selected) same(path.join(reproductionDir(key), rel), body, checkExisting);
    const lesson = readdirSync(CHAPTER).find((name) => name.startsWith((index + 1) + '-'));
    if (!lesson) throw new Error('Missing accepted replay lesson ' + (index + 1));
    const dir = path.join(CHAPTER, lesson);
    same(path.join(dir, '_files/acp-trace.json'), traces.starter, checkExisting);
    same(path.join(dir, '_solution/acp-trace.json'), traces.solved, checkExisting);
    // The introducing lesson reveals these files; later lessons carry them
    // in both their incoming and solved state. Generate every continuity copy.
    for (const name of readdirSync(CHAPTER)) {
      const number = Number(name.split('-')[0]);
      if (!Number.isFinite(number) || number < index + 1) continue;
      const states = number === index + 1 ? ['_solution'] : ['_files', '_solution'];
      for (const state of states) for (const [rel, body] of selected) {
        if (rel.endsWith('/answer.json')) continue;
        same(path.join(CHAPTER, name, state, 'reproduction', key, rel), body, checkExisting);
      }
    }
  }
  return capture;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const capture = generateReplay(process.argv.includes('--check-existing'));
  console.log('Regenerated S1/S2 deleted-trace replay from ' + capture.pin.sha256);
}
