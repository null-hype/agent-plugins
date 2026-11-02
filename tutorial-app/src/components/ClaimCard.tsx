import CheckBadge from './CheckBadge';
import { claimVerdict } from '../lib/claimVerdict';
import './Tidelands.css';
import './ClaimCard.css';

// A compact index entry for one claim report: the report hero's identifier,
// title, verdict and check, at card size. Its props are a subset of CompletedClaim.
export type ClaimCardProps = { identifier: string; title: string; exit: number; check: string; preregistered?: boolean; href: string };

export default function ClaimCard({ identifier, title, exit, check, preregistered, href }: ClaimCardProps) {
  const verdict = claimVerdict(exit);
  return <article className="td-panel td-card">
    <p className="td-eyebrow">{identifier}</p>
    <h3><a href={href}>{title}</a></h3>
    <div className="td-card-status"><CheckBadge kind={verdict.kind}>{verdict.label}</CheckBadge><span>Dagger exit {exit} · <code>{check}</code></span></div>
    {preregistered && <p className="td-card-marker">Preregistration attached</p>}
  </article>;
}
