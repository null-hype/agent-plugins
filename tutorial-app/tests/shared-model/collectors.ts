import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Collector } from '../questions/collectors';
import { parsePklError } from './pklError';

// The collector the shared model's Questions (`SharedModel.pkl`) name. It asks
// Pkl for one member of one revision's committed model (`pkl eval -x`, so each
// Question gets its own evaluation: Pkl evaluates members lazily, and a value
// it refuses for one reader does not touch the other's) and writes what Pkl
// said into the part's run directory, at `<revision>/<member>.json`.
//
// Pkl refusing a value is an answer, not a failure to collect: the model lets
// nothing through (0), and the record keeps Pkl's error and where it points.
// Only Pkl failing to say anything readable throws.

const here = path.dirname(fileURLToPath(import.meta.url));
export const revisionFile = (revision: string, file: string) => path.join(here, 'revisions', revision, file);

const evaluateModel: Collector = (partDir, { id, question }) => {
  const file = execFileSync('pkl', ['eval', '-x', 'file', path.join(here, 'SharedModel.pkl')], { encoding: 'utf8' }).trim();
  const { member } = question.judge;
  const source = revisionFile(question.revision, file);
  const run = spawnSync('pkl', ['eval', '-f', 'json', '-x', member, source], { encoding: 'utf8' });
  const pkl = execFileSync('pkl', ['--version'], { encoding: 'utf8' }).trim();
  let evaluation;
  if (run.status === 0) {
    const value = JSON.parse(run.stdout);
    if (typeof value !== 'number') throw new Error(`${id}: ${member} is not a number: ${run.stdout}`);
    evaluation = { exitCode: 0, value };
  } else {
    const error = parsePklError(run.stderr, file);
    if (!error.message || !error.locations.length) throw new Error(`${id}: Pkl exited ${run.status} without a readable error:\n${run.stderr}`);
    evaluation = { exitCode: run.status, error };
  }
  const record = { question: id, revision: question.revision, member, file, pkl, evaluation };
  mkdirSync(path.join(partDir, question.revision), { recursive: true });
  writeFileSync(path.join(partDir, question.revision, `${member}.json`), JSON.stringify(record, null, 2) + '\n');
  return [{ at: question.revision, answer: evaluation.exitCode === 0 ? evaluation.value : 0, evidence: { evaluation } }];
};

export const sharedModel: Record<string, Collector> = { 'evaluate-model': evaluateModel };
