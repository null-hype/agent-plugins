import type { ReactNode } from 'react';
import CheckBadge from './CheckBadge';
import EvidenceLines from './EvidenceLines';
import { TidelandsFooter, TidelandsHeader } from './TidelandsChrome';
import './Tidelands.css';

export type ClaimReportView = {
  identifier: string;
  title: string;
  description: ReactNode;
  verdict: ReactNode;
  exit: number | string;
  check: string;
  trace: ReactNode;
  snapshot: ReactNode;
  runKey: string;
  delivery: string;
  visibility: ReactNode;
  xenoName: string;
  xenoType: string;
};

// The publisher exports this same component to a Go HTML template. Slots keep
// optional evidence server-rendered; no browser runtime or React CDN is needed.
export function ClaimReportView({ identifier, title, description, verdict, exit, check, trace, snapshot, runKey, delivery, visibility, xenoName, xenoType }: ClaimReportView) {
  return <div className="td-page">
    <TidelandsHeader report />
    <main className="td-main">
      <header className="td-report-hero"><p className="td-eyebrow">Claim report / {identifier}</p><h1>{title}</h1><div className="td-report-status">{verdict}<p>Dagger exit {exit} · <code>{check}</code></p></div><p className="td-report-visibility">{visibility}</p></header>
      <div className="td-report-grid">
        <section className="td-panel" aria-labelledby="claim-heading"><div className="td-panel-heading"><h2 id="claim-heading">The claim</h2><span>Linear issue description</span></div>{description}<p className="td-report-description-note">Issue text as supplied for this rerun. This is not a copy of the preregistration or its diagnostics.</p></section>
        <aside className="td-report-side" aria-label="Rerun evidence">
          <section className="td-panel" aria-labelledby="rerun-heading"><div className="td-panel-heading"><h2 id="rerun-heading">Latest rerun</h2><span>Evidence</span></div><div className="td-panel-body"><dl className="td-report-facts"><dt>Dagger trace</dt><dd>{trace}</dd><dt id="restic-snapshot">Restic snapshot</dt><dd>{snapshot}</dd><dt>Run key</dt><dd><code>{runKey}</code></dd></dl><details className="td-report-detail"><summary>Run details</summary><dl className="td-report-facts"><dt>Linear delivery</dt><dd><code>{delivery}</code></dd><dt>Check</dt><dd><code>{check}</code></dd></dl></details></div></section>
          <section className="td-panel" id="xeno-status" data-status={xenoType} aria-labelledby="xeno-heading"><div className="td-panel-heading"><h2 id="xeno-heading">Xeno status</h2><CheckBadge kind={`workflow-${xenoType}`}>{xenoName}</CheckBadge></div><div className="td-panel-body"><p className="td-report-note">Linear issue status when this run completed. The check verdict above comes only from the Dagger exit code.</p></div></section>
        </aside>
      </div>
    </main>
    <TidelandsFooter />
  </div>;
}

export type CompletedClaim = {
  issue: { id: string; identifier: string; title: string; description: string; state?: { id: string; name: string; type: string } | null; labels?: { nodes: { name: string }[] } };
  delivery: string;
  check: string;
  exit: number;
  trace: string;
  snapshot: { id: string; url?: string; run_key: string };
  xeno: unknown;
};

export default function ClaimReport({ claim }: { claim: CompletedClaim }) {
  const isPublic = claim.issue.labels?.nodes.some(({ name }) => name === 'public');
  return <ClaimReportView identifier={claim.issue.identifier} title={claim.issue.title} description={<EvidenceLines text={claim.issue.description || 'No description supplied.'} />} verdict={<CheckBadge kind={claim.exit === 0 ? 'passed' : 'failed'}>{claim.exit === 0 ? 'Green · Passed' : 'Red · Failed'}</CheckBadge>} exit={claim.exit} check={claim.check} trace={claim.trace ? <a href={claim.trace} rel="noreferrer">Open trace ↗</a> : 'Unavailable'} snapshot={claim.snapshot.id ? <><code>{claim.snapshot.id}</code>{claim.snapshot.url && <> · <a href={claim.snapshot.url} rel="noreferrer">Snapshot evidence ↗</a></>}</> : 'Unavailable for this rerun'} runKey={claim.snapshot.run_key} delivery={claim.delivery} xenoName={claim.issue.state?.name || 'Unavailable'} xenoType={claim.issue.state?.name ? claim.issue.state.type || 'unknown' : 'unknown'} visibility={isPublic ? 'Public report. Later reruns replace the result at this URL.' : 'Unlisted report · noindex. Anyone with this link can view it. Later reruns replace the result at this URL.'} />;
}
