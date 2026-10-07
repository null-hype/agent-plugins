import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reproductionDir } from './fixture';
import { REVISIONS, pinnedInputs, sha256, type RevisionKey } from './probes';

// CIT-334: the `deleted-trace` Question across both checker revisions, as the
// shared evaluation record (src/jev/pkl/Question.pkl's `Investigation`).
//
// This is a capture, Vaults.pkl's "observed" half: it reads only committed
// evidence, through the same verified loader the probes use (`pinnedInputs`),
// and hashes every resource it cites. `traces/ReplayRecord.pkl` types and
// validates it; `traces/ReplayRecord.test.pkl` holds the generated records as
// the committed baseline. Nothing here runs the checker or changes a replay.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HISTORY = 'evidence/cit-294-review-history-v1';
const TRACES = path.join(APP, 'tests/rails-probes/traces');
const QUESTION = 'deleted-trace';
const ORDER: RevisionKey[] = ['S1', 'S2'];
/** The review of each revision, by its capture id in the history manifest. */
const REVIEW: Record<RevisionKey, string> = { S1: 'linear:CIT-294:comment:97e70a90', S2: 'linear:CIT-297:comment:271bc302' };

type Evidence = { uri: string; origin: 'historical' | 'reproduced'; availability: 'retained' | 'missing'; immutableId: string | null; reason: string | null };

const manifest = () => JSON.parse(readFileSync(path.join(APP, HISTORY, 'manifest.json'), 'utf8')) as {
  repository: string;
  captures: { captureId: string; file: string; sha256: string }[];
};

/** A committed file, by its sha256. */
function retained(rel: string, origin: Evidence['origin']): Evidence {
  return { uri: rel, origin, availability: 'retained', immutableId: `sha256:${sha256(readFileSync(path.join(APP, rel)))}`, reason: null };
}

const missing = (uri: string, origin: Evidence['origin'], reason: string): Evidence =>
  ({ uri, origin, availability: 'missing', immutableId: null, reason });

/** A historical capture (a PR body, a review), checked against the hash the history manifest pinned. */
function capture(captureId: string): { evidence: Evidence; text: string } {
  const entry = manifest().captures.find((c) => c.captureId === captureId);
  if (!entry) throw new Error(`no capture ${captureId} in the history manifest`);
  const rel = path.join(HISTORY, entry.file);
  const evidence = retained(rel, 'historical');
  if (evidence.immutableId !== `sha256:${entry.sha256}`) throw new Error(`${rel} does not match the history manifest`);
  return { evidence, text: readFileSync(path.join(APP, rel), 'utf8') };
}

/** One revision's record of the Question: its pinned state, the probe, the declared and observed counts, the answer. */
function record(key: RevisionKey) {
  const { pr, revision, findingId } = REVISIONS[key];
  const inputs = pinnedInputs(key).map((input) => ({
    uri: input.file,
    origin: 'historical' as const,
    availability: 'retained' as const,
    immutableId: `git-blob:${input.blobId}`,
    reason: null,
  }));
  const trace = inputs.find((e) => e.uri.endsWith('/canary-reads.txt'));
  if (!trace) throw new Error(`${key}: no pinned canary-reads.txt`);

  const run = path.relative(APP, reproductionDir(key));
  const probe = path.join(run, 'probes', QUESTION);
  const baseline = retained(path.join(run, 'runs/baseline/result.txt'), 'reproduced');
  const observedAsserts = Number(
    readFileSync(path.join(APP, baseline.uri), 'utf8').match(/% asserts pass \[(\d+) passed\]/)?.[1] ?? NaN,
  );

  // The PR's own line about its suite, declared next to the reproduced baseline.
  const body = capture(`github:pr:${pr}:body`);
  const line = body.text.split('\n').find((l) => /pkl test/.test(l) && /\d+ asserts/.test(l));
  if (!line) throw new Error(`PR ${pr}'s body states no assertion count`);
  const declaredAsserts = Number(line.match(/(\d+) asserts/)![1]);

  return {
    questionId: QUESTION,
    state: {
      id: `${key}-pinned`,
      source: { uri: manifest().repository, origin: 'historical', availability: 'retained', immutableId: `git-commit:${revision}`, reason: null },
      scope: ['The checker modules and retained arm evidence the pinned suite reads'],
      inputs,
      image: missing(`${key}/image`, 'historical', 'No image digest was recorded for this checker revision.'),
      snapshot: missing(`${key}/snapshot`, 'historical', 'No container snapshot was taken; only the checker inputs were retained.'),
      limitations: ['The application and its runtime state are not captured, only the checker inputs.'],
    },
    mutation: {
      action: 'Remove the retained trace from a copy of the pinned inputs',
      affects: [trace.uri],
      evidence: [retained(path.join(probe, 'mutation.txt'), 'reproduced')],
    },
    delivery: {
      feature: 'cve-2026-66066',
      version: null,
      status: 'planned',
      finding: findingId,
      scenario: 'test/_global/cve-2026-66066-forensics',
      evidence: null,
    },
    declarations: [
      {
        text: line.trim(),
        evidence: body.evidence,
        property: 'assertsTotal',
        declared: declaredAsserts,
        observed: observedAsserts,
        observedFrom: baseline,
      },
    ],
    forecast: null,
    answer: JSON.parse(readFileSync(path.join(APP, probe, 'answer.json'), 'utf8')),
    observations: [
      retained(path.join(probe, 'answer.json'), 'reproduced'),
      retained(path.join(probe, 'result.txt'), 'reproduced'),
      baseline,
      missing(`${key}/original-mutation-output`, 'historical', 'The reviewer\'s own deleted-trace output was not retained.'),
    ],
  };
}

/** The Question across every revision, and what moved the investigation from each to the next. */
export function captureInvestigation() {
  return {
    questionId: QUESTION,
    records: ORDER.map(record),
    transitions: ORDER.slice(1).map((to, n) => {
      const from = ORDER[n];
      return {
        from: `${from}-pinned`,
        to: `${to}-pinned`,
        action: `PR ${REVISIONS[to].pr} revises the checker in answer to review ${REVISIONS[from].review}`,
        finding: REVISIONS[from].findingId,
        evidence: [capture(REVIEW[from]).evidence, capture(`github:pr:${REVISIONS[to].pr}:body`).evidence],
      };
    }),
  };
}

/**
 * Type and validate a capture through `traces/ReplayRecord.pkl`. Returns the
 * record as JSON; throws (with Pkl's message) when the capture is not a valid record.
 */
export function evaluateRecord(investigation: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cit-334-'));
  try {
    const file = path.join(dir, 'capture.json');
    writeFileSync(file, JSON.stringify(investigation, null, 2));
    return execFileSync('pkl', ['eval', path.join(TRACES, 'ReplayRecord.pkl'), '-p', `capture=${file}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write the capture where `traces/ReplayRecord.test.pkl` reads it (`-p capture=<file>`). */
export function writeCapture(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(captureInvestigation(), null, 2)}\n`);
  return file;
}
