import type { ReactNode } from 'react';
import './EvidenceLines.css';

export function EvidenceLine({ number, highlighted = false, children }: { number: ReactNode; highlighted?: boolean; children: ReactNode }) {
  return <span className={highlighted ? 'highlight' : undefined}><i aria-hidden="true">{number}</i><code>{children}</code>{'\n'}</span>;
}

export function EvidenceListing({ children }: { children: ReactNode }) {
  return <pre className="td-source-lines">{children}</pre>;
}

export default function EvidenceLines({ text, highlight }: { text: string; highlight?: { from: number; to: number } }) {
  return <EvidenceListing>{text.split('\n').map((line, index) => <EvidenceLine key={index} number={index + 1} highlighted={Boolean(highlight && index + 1 >= highlight.from && index + 1 <= highlight.to)}>{line}</EvidenceLine>)}</EvidenceListing>;
}
