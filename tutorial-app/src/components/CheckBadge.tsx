import type { ReactNode } from 'react';
import './CheckBadge.css';

// Shared with the integration-check stories and the static claim renderer.
export default function CheckBadge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`ic-badge ic-${kind}`}>{children}</span>;
}
