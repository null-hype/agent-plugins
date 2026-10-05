import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerJson, answerText, reproductionDir, solvedFixture, type ProbeName } from './fixture';
import { FORGED_LINE, REVISIONS, loadPinnedChecker, noticed, pklVersion, runChecker, type CheckerRun, type RevisionKey } from './probes';

// CIT-320: does the checker investigation agree with itself? The probes spec
// asks the questions and records the answers; this spec trusts none of it. It
// re-runs the pinned checker on each RECORDED mutation and requires the same
// answer, checks the mutation is the one claimed, that the harness can fail at
// all, and that the lesson says what the record says. Whether the checker
// noticed a probe is not a rule: that is the answer, recorded as data.
// src/jev/pkl/Consistency.pkl decides; the facts and its verdict are written
// to CONSISTENCY_OUT (default test-results/rails-probes/consistency).

test.skip(pklVersion() === null, 'pkl is not on PATH');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(APP, process.env.CONSISTENCY_OUT ?? '../test-results/rails-probes/consistency');
const CHAPTER = path.join(APP, 'src/content/tutorial/part-4/can-the-checker-be-trusted');
const ORDER: RevisionKey[] = ['S1', 'S2'];
const PROBES: ProbeName[] = ['deleted-trace', 'forged-read'];
// What each probe expects of a checker that can be trusted: that it notices
// (CheckerProbes.pkl's `Probe.expected`). Not noticing is an out-of-range answer.
const EXPECTED = { min: 1, max: 1 };

type Rule = { held: boolean; detail?: string };
const rule = (held: boolean, detail: string): Rule => (held ? { held } : { held, detail });
/** A rule whose check throws does not hold: the throw is the detail. */
function attempt(fn: () => Rule): Rule {
  try {
    return fn();
  } catch (error) {
    return { held: false, detail: (error as Error).message.split('\n')[0] };
  }
}
const sameRun = (a: CheckerRun, b: CheckerRun) => answerJson(a) === answerJson(b);

test('the checker investigation is consistent', () => {
  const runRules: Record<string, Rule> = {};
  const findings: Record<string, unknown> = {};

  for (const [i, key] of ORDER.entries()) {
    const state = key.toLowerCase();
    const recorded = reproductionDir(key);
    let pinned: Map<string, Buffer> | null = null;
    runRules[`${state}-pinned-inputs`] = attempt(() => {
      pinned = loadPinnedChecker(key);
      return { held: true };
    });
    if (!pinned) continue;
    const inputs: Map<string, Buffer> = pinned;
    const { baseline: declared } = REVISIONS[key];

    const baseline = runChecker(inputs);
    runRules[`${state}-baseline-as-declared`] = rule(
      baseline.exitCode === 0 && baseline.testsTotal === declared.tests && baseline.testsPassed === declared.tests &&
        baseline.assertsTotal === declared.asserts && baseline.assertsPassed === declared.asserts,
      `retained checker: ${baseline.summary} (exit ${baseline.exitCode}); declared ${declared.tests} tests, ${declared.asserts} asserts`,
    );

    runRules[`${state}-baseline-recorded`] = attempt(() => {
      const result = readFileSync(path.join(recorded, 'runs/baseline/result.txt'), 'utf8');
      return rule(result.includes(`exit code: ${baseline.exitCode}\n`) && result.includes(`${baseline.summary}\n`),
        'runs/baseline/result.txt does not state the re-run baseline');
    });

    // The control: a field the checker does read. If this goes unnoticed the
    // watcher is blind, and no "not noticed" answer means anything.
    runRules[`${state}-harness-can-fail`] = attempt(() => {
      const files = new Map(inputs);
      const observed = JSON.parse(files.get('observations/mat-blocked.json')!.toString('utf8'));
      observed.block_untrusted_env = '0';
      files.set('observations/mat-blocked.json', Buffer.from(JSON.stringify(observed, null, 2)));
      return rule(noticed(runChecker(files)), 'flipping block_untrusted_env went unnoticed');
    });

    const solved = readFileSync(solvedFixture(key), 'utf8');
    const lessonDir = readdirSync(CHAPTER).find((name) => name.startsWith(`${i + 1}-`));
    const lesson = (rel: string) => (lessonDir ? path.join(CHAPTER, lessonDir, '_solution', rel) : '');
    runRules[`${state}-lesson-trace`] = rule(
      !!lessonDir && existsSync(lesson('acp-trace.json')) && readFileSync(lesson('acp-trace.json'), 'utf8') === solved,
      `lesson ${i + 1}'s solved trace is not the committed ${path.basename(solvedFixture(key))}`,
    );
    const messages = new Map<string, string>(
      JSON.parse(solved).frames[1].envelope.result._meta.probes.map((p: { diagnostic: { code: string; message: string } }) => [
        p.diagnostic.code.split('.').at(-1),
        p.diagnostic.message,
      ]),
    );

    for (const probe of PROBES) {
      const id = `${state}-${probe}`;
      const answerFile = path.join(recorded, 'probes', probe, 'answer.json');
      if (!existsSync(answerFile)) {
        findings[id] = { answerer: 'checker', value: null, expected: EXPECTED, rules: {} };
        continue;
      }
      const answer = JSON.parse(readFileSync(answerFile, 'utf8')) as CheckerRun;
      const rules: Record<string, Rule> = {};

      // The recorded mutation, re-applied from the record rather than from probes.ts.
      let mutated: Map<string, Buffer> | null = null;
      rules['mutation-as-claimed'] = attempt(() => {
        const files = new Map(inputs);
        if (probe === 'deleted-trace') {
          const claim = readFileSync(path.join(recorded, 'probes', probe, 'mutation.txt'), 'utf8');
          files.delete('canary-reads.txt');
          mutated = files;
          return rule(claim.startsWith('removed: canary-reads.txt'), `mutation.txt does not record removing the trace: ${claim.trim()}`);
        }
        const forged = readFileSync(path.join(recorded, 'probes', probe, 'canary-reads.txt'), 'utf8');
        const arms = forged.split('### ARM: ');
        const once = arms[2]?.startsWith('mat-blocked') && arms[2].split(`${FORGED_LINE}\n`).length === 2;
        arms[2] = arms[2]?.replace(`${FORGED_LINE}\n`, '');
        files.set('canary-reads.txt', Buffer.from(forged));
        mutated = files;
        return rule(!!once && arms.join('### ARM: ') === inputs.get('canary-reads.txt')!.toString('utf8'),
          'the recorded transcript is not the pinned one plus exactly one forged read in the mat-blocked arm');
      });

      const recomputed = mutated ? runChecker(mutated) : null;
      rules['answer-recomputed'] = rule(!!recomputed && sameRun(recomputed, answer),
        `recorded ${JSON.stringify(answer)}, re-run gives ${recomputed ? answerJson(recomputed).replace(/\s+/g, ' ') : 'nothing'}`);
      rules['result-agrees'] = attempt(() => {
        const result = readFileSync(path.join(recorded, 'probes', probe, 'result.txt'), 'utf8');
        return rule(result.includes(`exit code: ${answer.exitCode}\n`) && !!recomputed && result.includes(`${recomputed.summary}\n`),
          'result.txt does not state the recorded exit code and the re-run summary');
      });
      rules['full-pass-when-unnoticed'] = rule(noticed(answer) || answer.assertsTotal === declared.asserts,
        `"not noticed" with ${answer.assertsTotal} assertions, the baseline ran ${declared.asserts}`);
      rules['lesson-says-answer'] = rule(
        (messages.get(probe) ?? '').endsWith(answerText(probe, answer)) &&
          existsSync(lesson(`reproduction/${key}/probes/${probe}/result.txt`)) &&
          readFileSync(lesson(`reproduction/${key}/probes/${probe}/result.txt`), 'utf8') ===
            readFileSync(path.join(recorded, 'probes', probe, 'result.txt'), 'utf8'),
        `the lesson does not say "${answerText(probe, answer)}" or carries a different result.txt`,
      );

      findings[id] = { answerer: 'checker', value: noticed(answer) ? 1 : 0, expected: EXPECTED, rules };
    }
  }

  mkdirSync(OUT, { recursive: true });
  const factsFile = path.join(OUT, 'consistency-facts.json');
  writeFileSync(factsFile, `${JSON.stringify({ runId: process.env.CONSISTENCY_RUN_ID ?? 'local', runRules, findings }, null, 2)}\n`);
  const verdict = execFileSync('pkl', ['eval', '-f', 'json', '-p', `facts=${factsFile}`, path.join(APP, '../src/jev/pkl/Consistency.pkl')], { encoding: 'utf8' });
  writeFileSync(path.join(OUT, 'consistency.json'), verdict);
  const { consistent, broken } = JSON.parse(verdict) as { consistent: boolean; broken: string[] };
  expect(broken, 'the checker investigation contradicts its own records').toEqual([]);
  expect(consistent).toBe(true);
});
