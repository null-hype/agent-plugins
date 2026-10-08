// Restore the pinned, original installed-scenario observations. Viewing a replay
// never executes a checker or registers a round.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, withRetainedExport } from '../retained/export';
import { verifyEvidence } from '../../../src/cve-2026-66066/questions/retained';
import { REPRODUCTION_ID, REVISIONS, type RevisionKey } from './probes';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CAPTURE_PIN = path.join(APP, 'evidence/cit-337-captures-v1/bundle.json');
const DECODER = path.join(APP, '../src/cve-2026-66066/questions/checker/Record.pkl');
export type CapturedReplay = { investigation: any; files: Map<string, Buffer>; pin: any };

/** Verify the archive, complete inventory, shared Pkl record and every evidence reference. */
export function loadCapturedReplay(pinFile = CAPTURE_PIN): CapturedReplay {
  return withRetainedExport(pinFile, 'cit337-viewer-export-v2', ['S1', 'S2'], /^(S[12]\/|historical\/S[12]\/|capture\.json$|record\.json$)/, true, (dir, files, pin) => {
    const decoded = JSON.parse(execFileSync('pkl', ['eval', DECODER, '-p', 'capture=' + path.join(dir, 'capture.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    if (canonical(decoded) !== canonical(JSON.parse(files.get('record.json')!.toString()))) throw new Error('Captured record differs from the shared Pkl evaluation');
    if (decoded.questionId !== 'deleted-trace' || canonical(decoded.records.map((r: any) => r.state.id)) !== canonical(['S1-pinned', 'S2-pinned'])) throw new Error('Replay capture must contain S1 and S2 in order');
    verifyEvidence(decoded, files);
    for (const r of decoded.records) {
      const key = r.state.id.split('-')[0] as RevisionKey;
      if (r.state.source.immutableId !== 'git-commit:' + REVISIONS[key].revision || r.delivery.finding !== REVISIONS[key].findingId || r.delivery.status !== 'captured' || !r.answer) throw new Error('Capture does not match the selected revision');
      const observed = JSON.parse(files.get(key + '/runs/deleted-trace/answer.json')!.toString());
      if (canonical(observed) !== canonical(r.answer)) throw new Error('Captured answer disagrees with its retained observation');
      if (files.has(key + '/runs/deleted-trace/inputs/canary-reads.txt')) throw new Error('Captured mutation did not remove the trace');
      for (const e of r.state.inputs) {
        const name = e.uri.slice((key + '/inputs/').length);
        if (name === 'canary-reads.txt') continue;
        const actual = files.get(key + '/runs/deleted-trace/inputs/' + name);
        if (!actual || !actual.equals(files.get(e.uri)!)) throw new Error('Captured mutation changed another input: ' + name);
      }
    }
    return { investigation: decoded, files, pin };
  });
}

/** Compatibility files for the accepted Pkl presentation, derived from its captured record. */
export function capturedPresentation(capture: CapturedReplay, key: 'S1' | 'S2'): Map<string, string> {
  const r = capture.investigation.records.find((r: any) => r.state.id === key + '-pinned');
  const a = r.answer;
  const output = capture.files.get(key + '/runs/deleted-trace/result.txt')!.toString();
  const summary = output.split('\n').filter((l) => /% tests pass/.test(l)).join('').trim();
  const facts = output.split('\n').filter((l) => /^\s+[✔✘]/.test(l)).map((l) => l.trim());
  const revision = REVISIONS[key];
  const result = [
    'reproduction: ' + REPRODUCTION_ID,
    'probe: deleted-trace',
    'checker: PR ' + revision.pr + ' at ' + revision.revision.slice(0, 8) + ' (same cit-294 tree as ' + revision.mergedEquivalent!.slice(0, 8) + ' on main)',
    'mutation: canary-reads.txt removed',
    'exit code: ' + a.exitCode,
    summary, ...facts, '',
  ].join('\n');
  return new Map([
    ['probes/deleted-trace/answer.json', JSON.stringify(a, null, 2) + '\n'],
    ['probes/deleted-trace/result.txt', result],
    ['probes/deleted-trace/mutation.txt', 'removed: canary-reads.txt (the whole retained strace transcript)\n'],
    ['runs/baseline/canary-reads.txt', capture.files.get(key + '/inputs/canary-reads.txt')!.toString()],
  ]);
}
