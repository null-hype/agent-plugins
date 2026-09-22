import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import tutorialStore from 'tutorialkit:store';
import './AcpTraceBridge.css';
import {
  buildAcpTraceState,
  describeNextTurn,
  parseAcpTraceFixture,
  resolveAcpTraceConfig,
  valueToText,
} from '../lib/acpTraceProtocol';

type DocumentRecord = Record<
  string,
  | {
      filePath: string;
      loading: boolean;
      value: string | Uint8Array;
    }
  | undefined
>;

type LessonRecord = {
  data?: {
    custom?: unknown;
  };
};

type SolvableStore = {
  solve?: () => void;
  reset?: () => void;
  lessonFullyLoaded?: { get(): boolean; subscribe(listener: (value: boolean) => void): () => void };
};

const DEFAULT_TRACE_FILE = '/acp-trace.json';
const DEFAULT_SCENARIO = 'ghost-trace-diagnostic-v1';

interface Props {
  traceFile?: string;
  scenario?: string;
}

/**
 * CIT-245: unlike the headless RuleTraceBridge/LoanwordArcBridge (this
 * lesson runs with `editor: false`, so TutorialKit's own Solve button in the
 * editor panel's chrome is collapsed to zero size and unreachable -- see
 * WorkspacePanel.js's `EditorSection`), this bridge renders its own visible
 * Solve control and calls the store's `solve()`/`reset()` directly. Those
 * methods do the same `_files` -> `_solution` swap the built-in button
 * would have triggered; only the affordance that calls them is new.
 */
export default function AcpTraceBridge({
  traceFile = DEFAULT_TRACE_FILE,
  scenario = DEFAULT_SCENARIO,
}: Props) {
  const documents = useStore(tutorialStore.documents) as DocumentRecord;
  const revisionRef = useRef(0);
  const lesson = tutorialStore.lesson as LessonRecord | undefined;
  const solvable = tutorialStore as unknown as SolvableStore;
  const [lessonReady, setLessonReady] = useState(() => solvable.lessonFullyLoaded?.get() ?? true);

  useEffect(() => {
    return solvable.lessonFullyLoaded?.subscribe((value) => setLessonReady(value));
  }, [solvable]);

  const resolvedConfig = useMemo(() => {
    const customConfig = resolveAcpTraceConfig(lesson?.data?.custom);

    return {
      traceFile: customConfig?.traceFile ?? traceFile,
      scenario: customConfig?.scenario ?? scenario,
    };
  }, [lesson?.data?.custom, scenario, traceFile]);

  const traceText = valueToText(documents[resolvedConfig.traceFile]?.value);
  const traceState = useMemo(() => {
    revisionRef.current += 1;

    return buildAcpTraceState({
      revision: revisionRef.current,
      fixture: parseAcpTraceFixture(traceText),
      scenario: resolvedConfig.scenario,
    });
  }, [resolvedConfig.scenario, traceText]);

  // One payload, broadcast to every preview iframe (client and agent alike),
  // so both panes always agree on the same trace position -- see this
  // lesson's acceptance criteria on the two previews never disagreeing.
  //
  // Same delayed-retry shape as RuleTraceBridge/LoanwordArcBridge: an iframe
  // may not have its own message listener registered yet on the first post
  // (WebContainer boot, or Monaco still loading), so the same message --
  // same revision, not recomputed -- is resent a few times. Both preview
  // pages guard on `revision`, so a resend that does land after the first is
  // a no-op, not a re-trigger.
  useEffect(() => {
    const message = {
      payload: traceState,
      source: 'tk-acp-trace-bridge',
      type: 'lesson-state',
    };
    const delays = [0, 300, 900, 1600, 3200];
    const timeoutIds = delays.map((delay) =>
      window.setTimeout(() => {
        for (const frame of getPreviewFrames()) {
          frame.contentWindow?.postMessage(message, '*');
        }
      }, delay),
    );

    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [traceState]);

  const solveLabel = describeNextTurn(traceState.nextTurn);
  const canSolve = lessonReady && !traceState.solved && Boolean(solvable.solve);
  const canReset = lessonReady && Boolean(solvable.reset);

  return (
    <div className="acp-trace-controls">
      {solveLabel && (
        <button type="button" className="acp-trace-solve" disabled={!canSolve} onClick={() => solvable.solve?.()}>
          Solve: {solveLabel}
        </button>
      )}
      {!solveLabel && <span className="acp-trace-done">Trace complete.</span>}
      <button type="button" className="acp-trace-reset" disabled={!canReset} onClick={() => solvable.reset?.()}>
        Reset
      </button>
    </div>
  );
}

function getPreviewFrames() {
  return Array.from(
    document.querySelectorAll('#previews-container iframe, .previews-container iframe'),
  ) as HTMLIFrameElement[];
}
