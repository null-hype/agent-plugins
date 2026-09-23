import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef } from 'react';
import tutorialStore from 'tutorialkit:store';
import {
  buildAcpTraceState,
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

const DEFAULT_TRACE_FILE = '/acp-trace.json';
const DEFAULT_SCENARIO = 'ghost-trace-diagnostic-v1';
const READY_SOURCES = new Set(['tk-acp-trace-client-preview', 'tk-acp-trace-agent-preview']);

interface Props {
  traceFile?: string;
  scenario?: string;
}

/**
 * Headless, like RuleTraceBridge/LoanwordArcBridge. CIT-245 first shipped
 * this with its own Solve/Reset buttons embedded in the lesson markdown,
 * because `editor: false` collapsed TutorialKit's Solve to zero size. CIT-251
 * reverses that: ACP lessons run with `editor: true`, TutorialKit's own
 * Solve/Reset in the editor chrome is the only control, and the preview's
 * pending line names who acts next (the viewer observes a recorded turn; a
 * second button in the prose implied they were the one acting).
 */
export default function AcpTraceBridge({
  traceFile = DEFAULT_TRACE_FILE,
  scenario = DEFAULT_SCENARIO,
}: Props) {
  const documents = useStore(tutorialStore.documents) as DocumentRecord;
  const revisionRef = useRef(0);
  const lesson = tutorialStore.lesson as LessonRecord | undefined;

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

  // One payload, sent to every preview iframe (client and agent alike), so
  // both panes always agree on the same trace position -- see this lesson's
  // acceptance criteria on the two previews never disagreeing.
  //
  // Unlike the earlier delayed-retry approach (a fixed handful of resends
  // over ~3s, matching RuleTraceBridge/LoanwordArcBridge's *old* shape), a
  // slow WebContainer boot -- or reloading either preview after the retries
  // had already stopped -- left that pane waiting forever. Each preview page
  // now announces `lesson-preview-ready` itself once its own message
  // listener is registered (see acp-trace/server.cjs), the same handshake
  // LoanwordArcBridge already uses for its one preview: this bridge answers
  // that announcement by sending current state straight to the frame that
  // just asked, whenever that happens to be -- boot, reload, or otherwise --
  // instead of guessing a timeout. A state change (e.g. after Solve) is still
  // sent immediately to every frame already in the DOM; both pages guard on
  // `revision`, so any message that arrives out of order or twice is a no-op.
  useEffect(() => {
    const message = {
      payload: traceState,
      source: 'tk-acp-trace-bridge',
      type: 'lesson-state',
    };
    const send = (frame: HTMLIFrameElement) => frame.contentWindow?.postMessage(message, '*');
    const onReady = (event: MessageEvent) => {
      if (event.data?.type !== 'lesson-preview-ready' || !READY_SOURCES.has(event.data?.source)) {
        return;
      }
      const frame = getPreviewFrames().find((frame) => frame.contentWindow === event.source);
      if (frame) {
        send(frame);
      }
    };

    window.addEventListener('message', onReady);
    getPreviewFrames().forEach(send);

    return () => {
      window.removeEventListener('message', onReady);
    };
  }, [traceState]);

  return null;
}

function getPreviewFrames() {
  return Array.from(
    document.querySelectorAll('#previews-container iframe, .previews-container iframe'),
  ) as HTMLIFrameElement[];
}
