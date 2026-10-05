import { useEffect, useMemo, useState } from 'react';
import type { ArtifactRef, EvidenceRef, RecordedEvaluation, ReplayCursor, SuppliedArtifactResolver } from '../lib/acpReplayContract';
import { describeArtifactIdentity, recordLineNumber } from '../lib/evidenceArtifactResolver';
import './EvidenceInspector.css';

type Props = {
  evaluation: RecordedEvaluation;
  resolver: SuppliedArtifactResolver;
  cursor: ReplayCursor;
};

const decoder = new TextDecoder();

function evidenceLabel(evidence: EvidenceRef) {
  if (evidence.availability.status === 'missing') return evidence.evidenceId;
  return evidence.availability.artifact.path;
}

function describeLocation(location: ArtifactRef['location']) {
  if (location.kind === 'record') return `record ${location.record}${location.field ? ` · ${location.field}` : ''}`;
  return location.startLine === location.endLine ? `line ${location.startLine}` : `lines ${location.startLine}–${location.endLine}`;
}

export default function EvidenceInspector({ evaluation, resolver, cursor }: Props) {
  const [selectedId, setSelectedId] = useState(evaluation.evidence[0]?.evidenceId ?? null);
  const [content, setContent] = useState<{ status: 'idle' | 'loading' | 'resolved' | 'error'; text: string }>({ status: 'idle', text: '' });
  const selected = useMemo(() => evaluation.evidence.find(({ evidenceId }) => evidenceId === selectedId), [evaluation, selectedId]);

  useEffect(() => {
    let active = true;
    if (!selected) {
      setContent({ status: 'idle', text: '' });
      return () => { active = false; };
    }
    if (selected.availability.status === 'missing') {
      setContent({ status: 'error', text: `Unavailable: ${selected.availability.reason}` });
      return () => { active = false; };
    }
    setContent({ status: 'loading', text: 'Loading captured artifact…' });
    resolver.resolve(selected.availability.artifact).then((resolution) => {
      if (!active) return;
      if (resolution.status === 'resolved') setContent({ status: 'resolved', text: decoder.decode(resolution.bytes) });
      else if (resolution.status === 'artifact-identity-mismatch') setContent({ status: 'error', text: `Identity mismatch: bundle has ${resolution.actualIdentity}; requested ${describeArtifactIdentity(resolution.artifact.identity)}.` });
      else if (resolution.status === 'artifact-location-mismatch') setContent({ status: 'error', text: `Location mismatch: ${resolution.reason}.` });
      else setContent({ status: 'error', text: 'Unavailable: captured artifact was not found in this bundle.' });
    });
    return () => { active = false; };
  }, [resolver, selected]);

  const location = selected?.availability.status === 'captured' ? selected.availability.artifact.location : undefined;
  // A record is the Nth non-blank line, which is not necessarily physical line N.
  const recordLine = location?.kind === 'record' ? recordLineNumber(content.text, location.record) : null;
  const highlight = location?.kind === 'source-range'
    ? { from: location.startLine, to: location.endLine }
    : recordLine ? { from: recordLine, to: recordLine } : undefined;
  const lines = content.text.split('\n');

  return (
    <section className="evidence-inspector" aria-label="Captured evidence inspector">
      <header>
        <div><strong>{evaluation.diagnostic.code}</strong> · {evaluation.diagnostic.message}</div>
        <div className="identity">Evaluation <code>{evaluation.evaluationId}</code> · frame <code>{evaluation.frameId}</code> · cursor <code>{cursor.kind === 'frame' ? cursor.frameId : 'before-first'}</code></div>
      </header>
      <nav aria-label="Diagnostic evidence">
        {evaluation.evidence.map((evidence) => (
          <button key={evidence.evidenceId} type="button" aria-pressed={selectedId === evidence.evidenceId} onClick={() => setSelectedId(evidence.evidenceId)}>
            <span>{evidence.role}</span> {evidenceLabel(evidence)}
            <small>{evidence.availability.status === 'captured' ? describeArtifactIdentity(evidence.availability.artifact.identity) : 'summary only · no captured bytes'}</small>
          </button>
        ))}
      </nav>
      <div className={`artifact ${content.status === 'error' ? 'error' : ''}`} aria-live="polite">
        {selected?.availability.status === 'captured' && (
          <div className="artifact-heading">
            <strong>{selected.availability.artifact.path}</strong>
            <code>{selected.availability.artifact.recordingId}/{selected.availability.artifact.runId} · {describeArtifactIdentity(selected.availability.artifact.identity)}</code>
            <code>{describeLocation(selected.availability.artifact.location)}</code>
          </div>
        )}
        {content.status === 'resolved' ? (
          <pre>{lines.map((line, index) => <span key={index} className={highlight && index + 1 >= highlight.from && index + 1 <= highlight.to ? 'highlight' : ''}><i>{index + 1}</i>{line}{'\n'}</span>)}</pre>
        ) : <p>{content.text || 'No evidence is attached to this evaluation.'}</p>}
      </div>
    </section>
  );
}
