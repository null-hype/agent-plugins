import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pkl from './pkl.mjs';

// CIT-320: does a Jev run agree with itself? Jev's score cannot be recomputed,
// so this proves what can be: Jev was sent exactly the evidence on record, was
// asked the declared question and nothing more, and the score on record is the
// one it returned. Whether the score is in its expected range is not a rule:
// that is the answer, recorded as data. src/jev/pkl/Consistency.pkl decides.

const here = path.dirname(fileURLToPath(import.meta.url));
const consistencyModule = path.resolve(here, '../src/jev/pkl/Consistency.pkl');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readIf = (file) => (existsSync(file) ? read(file) : null);
const rule = (held, detail) => (held ? { held: true } : { held: false, detail });

/** The one `jev-evidence` attachment each question's test recorded, by question id. */
function evidenceById(report) {
  const evidence = {};
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const a of test.results.at(-1)?.attachments ?? []) {
          if (a.name !== 'jev-evidence') continue;
          const body = JSON.parse(a.body ? Buffer.from(a.body, 'base64').toString('utf8') : readFileSync(a.path, 'utf8'));
          (evidence[test.projectName] ??= []).push(body);
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return evidence;
}

/** Gather the facts of one run directory, as `run.mjs` lays it out. */
export function facts(runDir, backend) {
  const expected = read(path.join(runDir, 'report-expected.json'));
  const comparison = readIf(path.join(runDir, 'comparison.json'));
  const report = read(path.join(runDir, 'playwright-report.json'));
  const ledger = read(path.join(runDir, 'scores.json'));
  const evidence = evidenceById(report);

  const findings = {};
  for (const [id, question] of Object.entries(expected.questions)) {
    const row = comparison?.questions?.[id];
    const dir = path.join(runDir, 'questions', id);
    const score = ledger.scores[id];
    const collected = score != null && score.error == null && typeof score.probability === 'number';
    const skipped = row?.status === 'skipped';
    const rules = {};

    rules['executed-once'] = rule(skipped || (evidence[id]?.length === 1 && row?.status !== 'missing'),
      `expected one execution with one evidence record, found ${evidence[id]?.length ?? 0}`);
    rules['dependency-order'] = rule(row?.dependencyOrderValid === true, 'dependencies did not finish before this question started, or a skip names no blocker');

    if (!skipped && evidence[id]?.length === 1) {
      const state = evidence[id][0].state;
      const missing = question.requiredEvidence.filter((key) => !Object.hasOwn(state, key));
      rules['required-evidence'] = rule(missing.length === 0, `missing ${missing.join(', ')}`);
    }

    if (collected) {
      const request = readIf(path.join(dir, 'request.json'));
      const response = readIf(path.join(dir, 'response.json'));
      const result = readIf(path.join(dir, 'result.json'));
      rules['evidence-sent'] = rule(request != null && isDeepStrictEqual(request.state, evidence[id]?.[0]?.state),
        'the state in request.json is not the evidence attached to the test');
      const sent = request?.questions ?? {};
      rules['question-sent'] = rule(
        isDeepStrictEqual(Object.keys(sent), [id]) && isDeepStrictEqual(sent[id], question.judge) &&
          request.model === expected.model && !Object.hasOwn(sent[id], 'expected') &&
          isDeepStrictEqual(Object.keys(request).sort(), ['model', 'questions', 'state']),
        'request.json does not ask exactly the declared question, or it leaks the expected range');
      rules['score-on-record'] = rule(
        response?.answers?.[id]?.noul === score.probability && result?.probabilities?.[id] === score.probability &&
          result?.model === score.model && (response?.model ?? request?.model) === score.model,
        `ledger ${score.probability} (${score.model}) does not match response.json/result.json`);
      rules['backend-labelled'] = rule(score.backend === backend && result?.backend === backend,
        `the answer is labelled ${score.backend}, the run used ${backend}`);
    }

    findings[id] = {
      answerer: 'jev',
      skipped,
      value: collected ? score.probability : null,
      expected: question.expected,
      // Each Question asks whether its reader got the document, and the
      // recorded response says so deterministically: 200 with the document is
      // yes, 403 is no. A score pointing the other way (at or above one half
      // for no, below it for yes) disagrees with that anchor. A row, not a failure.
      disagreement: collected && evidence[id]?.length === 1 &&
        (score.probability >= 0.5) !== (evidence[id][0].state.http?.response?.status === 200),
      rules,
    };
  }

  // The contract this run was asked of, recomputed rather than taken from an
  // earlier reconcile, so records changed after it are still caught.
  const digest = createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  const metadata = report.config?.metadata ?? {};
  return {
    runId: ledger.runId,
    runRules: {
      'same-contract': rule(
        comparison != null && digest === ledger.contractDigest && digest === metadata.contractDigest && ledger.runId === metadata.runId,
        'the contract digest or run id differs between report-expected.json, scores.json and the Playwright report, or reconcile.mjs did not accept the run'),
      coverage: rule(comparison?.executionComplete === true, 'a declared question has no execution or answer, or an undeclared one appeared'),
    },
    findings,
  };
}

/** Write `consistency-facts.json` and `consistency.json` into the run directory, and return the latter. */
export function checkConsistency(runDir, backend) {
  const factsFile = path.join(runDir, 'consistency-facts.json');
  writeFileSync(factsFile, JSON.stringify(facts(runDir, backend), null, 2) + '\n');
  const result = pkl.load(consistencyModule, { facts: pathToFileURL(factsFile).href });
  writeFileSync(path.join(runDir, 'consistency.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
