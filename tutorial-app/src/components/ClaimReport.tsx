import type { ReactNode } from 'react';
import ClaimPreregistration from './ClaimPreregistration';
import type { ClaimPreregistration as PreregistrationArtifact } from '../lib/claimPreregistration';
import TidelandsContact from './TidelandsContact';
import { PredictionNotes, type Paragraph } from './TidelandsReport';
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
  /** Where the name links: relative on the site, absolute where the page is published elsewhere. */
  home?: string;
  /** For a reader: what the check predicts and how it could have failed. */
  summary?: ReactNode;
  /** What was predicted for this check, and where that stands. */
  prediction?: ReactNode;
};

// The publisher exports this same component to a Go HTML template, so every
// field is a slot Go fills. One check's report: what was claimed, its verdict,
// and the trace to follow it.
export function ClaimReportView({ identifier, check, title, verdict, trace, preregistration, home = 'https://www.tidelands.dev/', summary, prediction }: ClaimReportView) {
  return <div className="td-claim">
    <header className="td-hero-bar"><a href={home}>Richard Anthony</a></header>
    <main>
      <section className="td-report" aria-labelledby="claim-title">
        <p className="td-report-id">{identifier} · {check}</p>
        <h1 id="claim-title">{title}</h1>
        {summary && <p className="td-claim-summary">{summary}</p>}
        {prediction && <div className="td-claim-prediction">{prediction}</div>}
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

/** `paragraph` is the check's entry in the homepage report, when it has one. */
export default function ClaimReport({ claim, home, paragraph }: { claim: CompletedClaim; home?: string; paragraph?: Paragraph }) {
  return <ClaimReportView
    home={home}
    summary={paragraph?.why}
    prediction={paragraph?.prediction !== undefined ? <PredictionNotes p={paragraph} /> : undefined}
    identifier={claim.issue.identifier}
    check={claim.check}
    title={claim.issue.title}
    verdict={claim.exit === 0 ? 'Passed' : 'Failed'}
    trace={claim.trace ? <a href={claim.trace} rel="noreferrer">Trace ↗</a> : 'No trace'}
    preregistration={claim.preregistration ? <ClaimPreregistration artifact={claim.preregistration} /> : null}
  />;
}
