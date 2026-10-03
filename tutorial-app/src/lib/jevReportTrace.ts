import { resolveAcpTraceFixture, type AcpTraceState } from './acpTraceProtocol';
import type recorded from '../stories/fixtures/jev-recorded-run.json';

/** Project exported run artifacts into the existing editor diagnostic protocol. */
export function jevReportTrace(report: typeof recorded, options: { question?: number; solved?: boolean; frameId?: string } = {}): AcpTraceState {
  const { comparison, expected, ledger, states } = report;
  const commits = Object.entries(comparison.questions).map(([id, result]) => {
    const key = id as keyof typeof states;
    const state = states[key];
    const score = ledger.scores[key];
    const definition = expected.questions[key];
    const percentage = `${Math.round(result.probability * 100)}%`;
    return {
      sha: `snapshot:${state.revision}`,
      subject: id,
      diagnostic: {
        severity: result.accepted ? 'info' : 'error',
        code: `Jev ${percentage} · ${id}`,
        message: `${definition.judge.instructions}\nRecorded ${percentage}; expected ${result.expected.min * 100}–${result.expected.max * 100}%. ${result.outcome}.`,
        evaluationId: `${comparison.runId}:${comparison.contractDigest}:${id}`,
        related: [
          { role: 'axiom', uri: 'report-expected.pcf', detail: `${definition.judge.instructions}\nExpected ${result.expected.min * 100}–${result.expected.max * 100}%; contract ${comparison.contractDigest}` },
          { role: 'fact', uri: `questions/${id}/state.json#/state/authorizationPolicy`, revision: state.revision, detail: state.authorizationPolicy },
          { role: 'observation', uri: `questions/${id}/state.json#/state/http`, revision: state.revision, detail: JSON.stringify(state.http, null, 2) },
          { role: 'observation', uri: `questions/${id}/state.json#/state/prerequisites`, detail: JSON.stringify(state.prerequisites, null, 2) },
          { role: 'observation', uri: 'scores.json', detail: `Run ${comparison.runId}; ${score.backend}; ${score.model}; score ${result.probability}` },
        ],
      },
    };
  });
  const reportAt = (index: number, evaluated: boolean) => {
    const ids = commits.slice(0, index + 1).map(c => c.subject as keyof typeof states);
    const selected = ids[index];
    return {
      selected,
      comparison: { runId: comparison.runId, questions: Object.fromEntries(ids.map(id => [id,
        id === selected && !evaluated
          ? { expected: comparison.questions[id].expected, outcome: 'pending', dependencies: comparison.questions[id].dependencies }
          : comparison.questions[id],
      ])) },
      states: Object.fromEntries(ids.map(id => [id, states[id]])),
      expected: { questions: Object.fromEntries(ids.map(id => [id, expected.questions[id]])) },
      ledger: { scores: Object.fromEntries(ids.filter(id => evaluated || id !== selected).map(id => [id, ledger.scores[id]])) },
    };
  };
  const question = options.question ?? 2;
  const frames = commits.slice(0, question + 1).flatMap((commit, index) => {
    const id = commit.subject as keyof typeof states;
    const state = states[id];
    const common = {
      actor: 'agent' as const,
      provenance: { recordingId: comparison.runId, capturedAt: new Date(comparison.questions[id].finishedAt).toISOString() },
    };
    const evidence = {
      ...common, reportView: reportAt(index, false), speaker: 'playwright', action: 'inspect recorded evidence',
      envelope: { jsonrpc: '2.0', id: index * 2, result: { _meta: {
        pins: [
          { id: `${id}:question`, label: 'Question', text: expected.questions[id].judge.instructions },
          { id: `${id}:policy`, label: `Policy · ${state.revision}`, text: state.authorizationPolicy },
          { id: `${id}:http`, label: 'Recorded HTTP observations', text: JSON.stringify(state.http, null, 2) },
        ],
        verdict: { channel: 'review' as const, status: 'pending' as const, text: 'Evidence collected. Solve reveals the recorded Jev evaluation.' },
      } } },
      rebaseTodo: { commits: [...commits.slice(0, index), { sha: commit.sha, subject: commit.subject }], comment: 'Fixture snapshots; no Git commit hashes were recorded.' },
    };
    const evaluation = {
      ...common, reportView: reportAt(index, true), speaker: 'jev', action: 'reveal recorded evaluation',
      envelope: { jsonrpc: '2.0', id: index * 2 + 1, result: { _meta: {
        pins: [{ id: `${id}:run`, label: 'Recorded Jev run', text: comparison.runId }],
        verdict: { channel: 'experiment' as const, status: comparison.questions[id].accepted ? 'pass' as const : 'fail' as const, text: commit.diagnostic.message },
      } } },
      rebaseTodo: { commits: commits.slice(0, index + 1), comment: 'Select a Jev diagnostic to inspect its evidence and Pkl expectation.' },
    };
    return [evidence, evaluation];
  });
  const solved = options.solved ?? true;
  const visible = solved || options.frameId ? frames : frames.slice(0, -1);
  const frameIds = visible.map((_, index) => `${commits[Math.floor(index / 2)].subject}:${index % 2 ? 'evaluation' : 'evidence'}`);
  const fixture = resolveAcpTraceFixture({
    scenario: 'jev-report-v1', frameIds,
    nextTurn: solved || options.frameId ? null : { actor: 'agent', speaker: 'jev', action: 'reveal recorded evaluation' },
  }, id => JSON.stringify(visible[frameIds.indexOf(id)]), { frameId: options.frameId });
  return { revision: 1, ...fixture, solved: fixture.nextTurn === null };
}
