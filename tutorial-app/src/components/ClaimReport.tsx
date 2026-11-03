import type { ReactNode } from 'react';
import ClaimPreregistration from './ClaimPreregistration';
import type { ClaimPreregistration as PreregistrationArtifact } from '../lib/claimPreregistration';
import TidelandsContact from './TidelandsContact';
import './TidelandsHero.css';
import './TidelandsReport.css';
import './ClaimReport.css';

export type ClaimReportView = {
  identifier: string;
  check: string;
  title: string;
  verdict: ReactNode;
  trace: ReactNode;
  preregistration: ReactNode;
};

// The publisher exports this same component to a Go HTML template, so every
// field is a slot Go fills. One check's report: what was claimed, its verdict,
// and the trace to follow it.
export function ClaimReportView({ identifier, check, title, verdict, trace, preregistration }: ClaimReportView) {
  return <div className="td-claim">
    <header className="td-hero-bar"><a href="https://www.tidelands.dev/">Richard Anthony</a></header>
    <main>
      <section className="td-report" aria-labelledby="claim-title">
        <p className="td-report-id">{identifier} · {check}</p>
        <h1 id="claim-title">{title}</h1>
        <p className="td-claim-verdict">{verdict}</p>
        <p>{trace}</p>
        {preregistration}
      </section>
      <TidelandsContact />
    </main>
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
  preregistration?: PreregistrationArtifact | null;
};

export default function ClaimReport({ claim }: { claim: CompletedClaim }) {
  return <ClaimReportView
    identifier={claim.issue.identifier}
    check={claim.check}
    title={claim.issue.title}
    verdict={claim.exit === 0 ? 'Passed' : 'Failed'}
    trace={claim.trace ? <a href={claim.trace} rel="noreferrer">Trace ↗</a> : 'No trace'}
    preregistration={claim.preregistration ? <ClaimPreregistration artifact={claim.preregistration} /> : null}
  />;
}
