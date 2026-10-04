import { useEffect, useMemo, useState } from 'react';
import { AcpReplayController, type ReplayControllerState } from '../lib/acpReplayController';
import type { ArtifactRef, ReplayRecording, ReplaySnapshot } from '../lib/acpReplayContract';
import { deriveTraceView } from '../lib/acpTraceProtocol';

const isSnapshot = (state: ReplayControllerState): state is ReplaySnapshot => 'location' in state;

function describeArtifact(ref: ArtifactRef) {
  const location = ref.location.kind === 'record'
    ? `record ${ref.location.record}${ref.location.field ? ` · ${ref.location.field}` : ''}`
    : `lines ${ref.location.startLine}–${ref.location.endLine}`;
  const identity = ref.identity.kind === 'revision' ? ref.identity.revision : ref.identity.kind === 'capture' ? ref.identity.captureId : ref.identity.snapshotId;
  return { location, identity };
}

export default function RecordedRunDebugger({ recording, initialFrameId }: { recording: ReplayRecording; initialFrameId?: string }) {
  const controller = useMemo(() => new AcpReplayController(recording, initialFrameId ? { cursor: { kind: 'frame', frameId: initialFrameId } } : undefined), [recording, initialFrameId]);
  const [state, setState] = useState(() => controller.getState());
  const [artifact, setArtifact] = useState<ArtifactRef | null>(null);
  useEffect(() => controller.subscribe(setState), [controller]);

  if (!isSnapshot(state)) {
    return <section role="alert"><strong>Replay unavailable:</strong> {state.status}{'reason' in state ? ` — ${state.reason}` : ''}</section>;
  }

  const cursor = state.location.cursor;
  const cursorId = cursor.kind === 'frame' ? cursor.frameId : 'before-first';
  const selectedEvaluationId = state.selection?.kind === 'evaluation' ? state.selection.evaluationId : undefined;
  const selectedEvaluation = state.evaluations.find(({ evaluationId }) => evaluationId === selectedEvaluationId);
  const traceView = deriveTraceView(state.frames);

  return (
    <section aria-label="Recorded run" style={{ font: '14px system-ui', maxWidth: 920, color: '#28251f' }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Recorded run · {recording.recordingId} / {recording.runId}</strong>
        <span>Frame {cursorId} of {recording.frames.length}</span>
        <button onClick={() => { setArtifact(null); controller.stepBack(); }}>Step back</button>
        <button onClick={() => controller.stepForward()}>Step forward</button>
        <button onClick={() => controller.continueToDiagnostic()}>Continue to diagnostic</button>
        <button onClick={() => { setArtifact(null); controller.reset(); }}>Reset replay</button>
      </header>

      <div style={{ marginTop: 12, padding: 12, background: '#fff9ea', border: '1px solid #dccda8' }}>
        {state.frames.map((frame) => {
          const params = frame.envelope.params as { prompt?: Array<{ text?: string }> } | undefined;
          const prompt = params?.prompt?.map(({ text }) => text).filter(Boolean).join(' ');
          return <div key={frame.frameId}><strong>{frame.frameId}</strong> · {frame.action}{prompt ? ` — ${prompt}` : ''}</div>;
        })}
      </div>

      <div aria-label="Recorded evaluations" style={{ marginTop: 12 }}>
        {state.evaluations.map((evaluation) => (
          <div key={evaluation.evaluationId}>
            <button onClick={() => controller.select({ kind: 'evaluation', evaluationId: evaluation.evaluationId })} style={{ margin: '6px 0' }}>
              {evaluation.diagnostic.code}: {evaluation.diagnostic.message}
            </button>
            <small style={{ marginLeft: 8 }}>{evaluation.evaluationId}</small>
          </div>
        ))}
      </div>

      {selectedEvaluation && (
        <section aria-label="Related evidence" style={{ borderLeft: '3px solid #8f6d2e', paddingLeft: 12 }}>
          <div><strong>{selectedEvaluation.evaluationId}</strong></div>
          {selectedEvaluation.diagnostic.related.map((item, index) => <div key={`${item.uri}-${index}`}>{item.uri} — {item.detail}</div>)}
          {selectedEvaluation.evidence.map((item) => {
            if (item.availability.status === 'missing') return <div key={item.evidenceId}>Evidence unavailable: {item.availability.reason}</div>;
            const artifactRef = item.availability.artifact;
            return <a href="#artifact" key={item.evidenceId} onClick={(event) => { event.preventDefault(); setArtifact(artifactRef); }} style={{ display: 'block', marginTop: 6 }}>
              {item.contentKind === 'source' ? 'Governing rule' : item.evidenceId === 'arrival-order-observation' ? 'Missing delivery observation' : 'Repair observation'}
            </a>;
          })}
        </section>
      )}

      <footer style={{ marginTop: 12 }}>Derived prefix: {traceView.pins.length} pins · {Object.values(traceView.channels).reduce((sum, values) => sum + values.length, 0)} verdict records</footer>

      {artifact && (() => {
        const description = describeArtifact(artifact);
        return <div role="dialog" aria-label="Artifact" style={{ position: 'fixed', inset: '20% 15%', background: 'white', border: '2px solid #6e582d', padding: 20, zIndex: 2 }}>
          <strong>{artifact.path.split('/').at(-1)} · {description.location}</strong>
          <div>{artifact.path}</div><div>{description.identity}</div>
          <p>This immutable reference is ready for the supplied artifact resolver.</p>
          <button onClick={() => setArtifact(null)}>Close artifact</button>
        </div>;
      })()}
    </section>
  );
}
