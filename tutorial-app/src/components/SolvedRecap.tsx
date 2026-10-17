import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import tutorialStore from 'tutorialkit:store';
import { valueToText } from '../lib/acpTraceProtocol';

type DocumentRecord = Record<string, { value: string | Uint8Array } | undefined>;

/**
 * A part 5 lesson's results, held back until Solve (CIT-422). The prose before
 * it says what changed and which question to ask; the counts would spoil the
 * questions the reader is about to accept, so they wait here. Solve swaps
 * `/acp-trace.json` for the solved trace, whose `nextTurn` is null: that, not
 * a button's own state, is what reveals the recap, so Reset hides it again.
 */
export default function SolvedRecap({ traceFile = '/acp-trace.json', children }: {
  traceFile?: string;
  children?: React.ReactNode;
}) {
  const documents = useStore(tutorialStore.documents) as DocumentRecord;
  const [domLoaded, setDomLoaded] = useState(false);

  useEffect(() => setDomLoaded(true), []);

  if (!domLoaded || !solved(valueToText(documents[traceFile]?.value))) {
    return <p className="solved-recap-pending"><em>The recap appears here after you select <strong>Solve</strong>.</em></p>;
  }
  return <div className="solved-recap">{children}</div>;
}

function solved(text: string | undefined): boolean {
  if (!text) return false;
  try {
    return JSON.parse(text).nextTurn === null;
  } catch {
    return false;
  }
}
