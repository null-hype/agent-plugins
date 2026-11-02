import { useEffect, useRef, useState, type ReactNode } from 'react';
import { projectPreregistration, type ClaimPreregistration as Artifact, type PreregistrationProjection } from '../lib/claimPreregistration';
import { enhancePreregistration } from '../lib/claimMonaco';
import './ClaimPreregistration.css';

export function PreregistrationFrame({ file, children }: { file: string; children: ReactNode }) {
  return <section className="td-panel td-preregistration" data-preregistration-file={file} aria-labelledby="preregistration-heading"><div className="td-panel-heading"><h2 id="preregistration-heading">Preregistration</h2><span>{file}</span></div>{children}</section>;
}

// The Go export and React stories share every piece of the static markup.
export function PreregistrationBody({ source, notice, children }: { source: string; notice: string; children: ReactNode }) {
  return <><p className="td-editor-status" data-editor-status="">Read-only · Source and findings from this rerun</p><div data-claim-editor="" className="td-claim-editor" /><div className="td-preregistration-static" aria-label="Preregistration source and findings">{children}</div><p className="td-findings-notice">{notice}</p><pre data-preregistration-source="" hidden>{source}</pre></>;
}
export function PredictionLine({ number, text, highlighted, children }: { number: number | string; text: string; highlighted?: boolean | string; children: ReactNode }) {
  return <div className="td-prediction-line" data-highlighted={highlighted}><div className="td-prediction-source"><span aria-hidden="true">{number}</span><code>{text || ' '}</code></div>{children}</div>;
}
export function ClaimFinding({ line, column, severity, message, evidence }: { line: number | string; column: number | string; severity: string; message: string; evidence: ReactNode }) {
  return <div className="td-claim-diagnostic" data-claim-diagnostic="" data-line={line} data-column={column} data-severity={severity}><strong>{severity}</strong><p data-diagnostic-message="">{message}</p>{evidence}</div>;
}
export function PreregistrationContent({ source, projection }: { source: string; projection: PreregistrationProjection }) {
  return <PreregistrationBody source={source} notice={projection.notice}>{projection.lines.map((text, index) => {
    const findings = projection.diagnostics.filter(finding => finding.line === index + 1);
    return <PredictionLine key={index} number={index + 1} text={text} highlighted={findings.length > 0 ? 'true' : undefined}>{findings.map((finding, at) => <ClaimFinding key={at} {...finding} evidence={finding.evidence.length > 0 && <p className="td-finding-evidence">Evidence paths: {finding.evidence.join(', ')}</p>} />)}</PredictionLine>;
  })}</PreregistrationBody>;
}

export default function ClaimPreregistration({ artifact }: { artifact?: Artifact | null }) {
  const root = useRef<HTMLDivElement>(null);
  const [projection, setProjection] = useState<PreregistrationProjection>();
  useEffect(() => {
    let active = true;
    setProjection(undefined);
    if (artifact) void projectPreregistration(artifact).then(value => { if (active) setProjection(value); });
    return () => { active = false; };
  }, [artifact]);
  useEffect(() => { if (root.current && projection) return enhancePreregistration(root.current); }, [projection]);
  if (!artifact) return <PreregistrationFrame file="Not supplied"><p className="td-panel-body">Preregistration unavailable for this rerun.</p></PreregistrationFrame>;
  return <PreregistrationFrame file={artifact.file}><div ref={root}>{projection ? <PreregistrationContent source={artifact.source} projection={projection} /> : <p className="td-panel-body">Loading preregistration…</p>}</div></PreregistrationFrame>;
}
