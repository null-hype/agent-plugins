import CheckBadge from './CheckBadge';
import { claimStanding, type Requirement } from '../lib/claimVerdict';
import './Tidelands.css';
import './ClaimCard.css';

// A compact index entry for one claim report: the report hero's identifier,
// title, verdict and check, at card size. Its props are a subset of CompletedClaim,
// plus the controls it requires. An absent exit means the check has not run.
export type ClaimCardProps = { identifier: string; title: string; exit?: number; check: string; preregistered?: boolean; href: string; detail?: string; requires?: Requirement[] };

export default function ClaimCard({ identifier, title, exit, check, preregistered, href, detail, requires = [] }: ClaimCardProps) {
  const verdict = claimStanding(exit, requires);
  return <article className="td-panel td-card">
    <p className="td-eyebrow">{identifier}</p>
    <h3><a href={href}>{title}</a></h3>
    {detail && <p className="td-card-detail">{detail}</p>}
    <div className="td-card-status"><CheckBadge kind={verdict.kind}>{verdict.label}</CheckBadge><span>{exit !== undefined && <>Dagger exit {exit} · </>}<code>{check}</code></span></div>
    {requires.length > 0 && <ul className="td-card-requires" aria-label="Requires">
      {requires.map(r => <li key={r.identifier} className={`td-light td-light-${r.exit === undefined ? 'untested' : r.exit === 0 ? 'passed' : 'failed'}`}>{r.identifier} · {r.title} · {r.exit === undefined ? 'not run' : r.exit === 0 ? 'passed' : 'failed'}</li>)}
    </ul>}
    {preregistered && <p className="td-card-marker">Preregistration attached</p>}
  </article>;
}
