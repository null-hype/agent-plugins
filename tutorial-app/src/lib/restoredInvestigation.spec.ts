import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInvestigationModel } from './investigationModel';
import { type CheckerResult, MissingRetrievedInput, investigationFromRestored, parseResticDiff } from './restoredInvestigation';

// Bytes restic dumped back from Drive in the third live round trip (CIT-378 / #181).
const dir = new URL('../stories/fixtures/protondrive/investigation/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');
const diff = parseResticDiff(read('restic-diff.ndjson'));
const agent = {
  'inputs/canary-reads.txt': read('agent/inputs/canary-reads.txt'),
  'inputs/run_arms.sh': read('agent/inputs/run_arms.sh'),
  'inputs/observations/forged-read.json': read('agent/inputs/observations/forged-read.json'),
};
const baseline = {
  'inputs/canary-reads.txt': read('baseline/inputs/canary-reads.txt'),
  'inputs/run_arms.sh': read('baseline/inputs/run_arms.sh'),
};

// Sample output in the checker's result shape. It exercises the viewer only: it
// was not produced by running a checker, so it cannot satisfy CIT-392's real-finding criterion.
const sample = (findings: CheckerResult['findings']): CheckerResult => ({
  checker: { name: 'sample-checker', version: '0.0.0' },
  origin: 'illustrative',
  findings,
  raw: '',
});
const forged = { path: '/inputs/observations/forged-read.json', line: 7, message: 'sample: no process opened the private file' };
const build = (result: CheckerResult, files = { agent, baseline }) =>
  investigationFromRestored({ vault: 'investigations', question: 'q', snapshot: '3b98922e', tag: 't', changes: diff, ...files, result });

describe('investigationFromRestored', () => {
  it('reads the changes from the restic diff, without directories or statistics', () => {
    expect(diff.map((c) => `${c.modifier} ${c.path}`)).toEqual([
      'M /inputs/canary-reads.txt',
      '+ /inputs/observations/forged-read.json',
      'M /inputs/run_arms.sh',
    ]);
  });

  it('takes the file contents and baselines from the restored bytes', () => {
    const [q] = build(sample([forged])).agent;
    const canary = q.changes.find((c) => c.path === 'inputs/canary-reads.txt');
    expect(canary?.contents).toBe(agent['inputs/canary-reads.txt']);
    expect(canary?.baseline).toBe(baseline['inputs/canary-reads.txt']);
  });

  it('derives the finding count, message and line from the checker result alone', () => {
    const one = build(sample([forged]));
    expect(one.agent[0].evidence).toBe('Illustrative: 1 finding from sample-checker 0.0.0.');
    const model = buildInvestigationModel(one);
    const doc = model.documents.find((d) => d.uri.path.endsWith('forged-read.json'));
    expect(doc?.markers.map((m) => [m.line, m.message])).toEqual([[7, 'sample: no process opened the private file']]);

    const none = build(sample([]));
    expect(none.agent[0].evidence).toBe('Illustrative: 0 findings from sample-checker 0.0.0.');
    expect(none.agent[0].changes.some((c) => c.finding || c.note)).toBe(false);

    const two = build(sample([forged, { path: 'inputs/run_arms.sh', line: 3, message: 'sample: crash' }]));
    expect(two.agent[0].changes.filter((c) => c.finding)).toHaveLength(2);
  });

  it('fails explicitly when a retrieved input is missing', () => {
    const { 'inputs/observations/forged-read.json': _, ...rest } = agent;
    expect(() => build(sample([forged]), { agent: rest, baseline })).toThrow(MissingRetrievedInput);
    const { 'inputs/run_arms.sh': __, ...noBaseline } = baseline;
    expect(() => build(sample([forged]), { agent, baseline: noBaseline })).toThrow(/inputs\/run_arms\.sh was not retrieved from the baseline/);
  });

  it('rejects a finding in a file the diff does not list', () => {
    expect(() => build(sample([{ path: 'inputs/other.txt', line: 1, message: 'x' }]))).toThrow(MissingRetrievedInput);
  });
});
