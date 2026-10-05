import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import tutorialStore from 'tutorialkit:store';
import {
  buildAcpTraceState,
  frameFilePath,
  parseAcpTraceFixtureRef,
  resolveAcpTraceConfig,
  resolveAcpTraceFixture,
  valueToText,
} from '../lib/acpTraceProtocol';
import { OPEN_ARTIFACT_REQUEST, answerOpenRequest } from '../lib/artifactOpen';
import { BundleArtifactResolver, type EvidenceBundle } from '../lib/evidenceArtifactResolver';

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
// CIT-301: the captured files behind evidence rows, shipped with the lesson.
const EVIDENCE_BUNDLE_FILE = '/evidence-bundle.json';
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
  // cit294-review-v1: the Client reports whether the viewer has accepted a
  // suggestion; null until it has ever reported (every other scenario).
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const agentWindows = useRef(new Set<Window>());
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

    const ref = parseAcpTraceFixtureRef(traceText);
    const loadFrame = (frameId: string) => documents[frameFilePath(resolvedConfig.traceFile, frameId)]?.value;

    return buildAcpTraceState({
      revision: revisionRef.current,
      fixture: resolveAcpTraceFixture(ref, loadFrame),
      scenario: resolvedConfig.scenario,
    });
  }, [resolvedConfig.scenario, resolvedConfig.traceFile, traceText, documents]);

  // A lesson without the file has no bundle: its rows can say so, not open.
  const bundleText = valueToText(documents[EVIDENCE_BUNDLE_FILE]?.value);
  const resolver = useMemo(() => {
    if (!bundleText) return null;
    try {
      return new BundleArtifactResolver(JSON.parse(bundleText) as EvidenceBundle);
    } catch {
      return null;
    }
  }, [bundleText]);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

  // Opening a row's captured file is answered here, to the frame that asked, and
  // changes nothing about the trace, the revision or what has been accepted.
  useEffect(() => {
    const onOpenRequest = (event: MessageEvent) => {
      if (event.data?.type !== OPEN_ARTIFACT_REQUEST || event.data?.source !== 'tk-acp-trace-client-preview') return;
      const asker = event.source as Window | null;
      answerOpenRequest(resolverRef.current, event.data).then((reply) => asker?.postMessage(reply, '*'));
    };
    window.addEventListener('message', onOpenRequest);
    return () => window.removeEventListener('message', onOpenRequest);
  }, []);

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
    const clientMessage = { payload: traceState, source: 'tk-acp-trace-bridge', type: 'lesson-state' };
    // Only the Agent pane is told about acceptance: it holds back its diagnosis
    // until the viewer has taken a suggestion in the Client.
    // The pane ignores a revision it has already seen, and acceptance changes
    // without the trace changing, so each (trace, acceptance) pair gets its own
    // revision for the Agent: 4r, 4r+1 (not accepted), 4r+2 (accepted).
    const agentMessage = {
      ...clientMessage,
      payload: accepted === null ? { ...traceState, revision: traceState.revision * 4 } : { ...traceState, accepted, revision: traceState.revision * 4 + (accepted ? 2 : 1) },
    };
    const send = (frame: HTMLIFrameElement) =>
      frame.contentWindow?.postMessage(
        frame.contentWindow && agentWindows.current.has(frame.contentWindow) ? agentMessage : clientMessage,
        '*',
      );
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'acp-trace-suggestion-accepted') {
        if (event.data?.source === 'tk-acp-trace-client-preview') setAccepted(Boolean(event.data.accepted));
        return;
      }
      if (event.data?.type !== 'lesson-preview-ready' || !READY_SOURCES.has(event.data?.source)) {
        return;
      }
      if (event.data.source === 'tk-acp-trace-agent-preview' && event.source) {
        agentWindows.current.add(event.source as Window);
      }
      const frame = getPreviewFrames().find((frame) => frame.contentWindow === event.source);
      if (frame) {
        send(frame);
      }
    };

    window.addEventListener('message', onMessage);
    getPreviewFrames().forEach(send);

    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [traceState, accepted]);

  return null;
}

function getPreviewFrames() {
  return Array.from(
    document.querySelectorAll('#previews-container iframe, .previews-container iframe'),
  ) as HTMLIFrameElement[];
}
