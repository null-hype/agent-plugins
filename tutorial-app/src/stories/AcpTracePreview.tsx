import React, { useEffect, useMemo, useRef, useState } from 'react';
import clientPageHtml from 'virtual:acp-trace-client-page';
import agentPageHtml from 'virtual:acp-trace-agent-page';
import type { SuppliedArtifactResolver } from '../lib/acpReplayContract';
import type { AcpTraceState } from '../lib/acpTraceProtocol';
import { OPEN_ARTIFACT_REQUEST, answerOpenRequest } from '../lib/artifactOpen';
import { BundleArtifactResolver, type EvidenceBundle } from '../lib/evidenceArtifactResolver';

type Props = {
	payload?: AcpTraceState;
	height?: number;
	/** The captured files behind evidence rows that cite one (CIT-301). Without it, such a row says it cannot be opened. */
	evidence?: EvidenceBundle;
};

// Mirrors OtelWarmLogPreview's shape (payload -> postMessage once each iframe
// announces readiness), but for acp-trace's two independent pages instead of
// one -- both receive the exact same payload, which is what makes "both
// previews agree on the visible trace position" true by construction rather
// than by coordination.
function Pane({
	html,
	payload,
	height,
	label,
	onAccepted,
	resolver,
}: {
	html: string;
	payload?: AcpTraceState;
	height: number;
	label: string;
	onAccepted?: (accepted: boolean) => void;
	resolver?: SuppliedArtifactResolver | null;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const resolverRef = useRef(resolver ?? null);
	resolverRef.current = resolver ?? null;
	const readyRef = useRef(false);
	const revisionRef = useRef(0);

	const send = () => {
		if (!payload || !readyRef.current) return;
		revisionRef.current += 1;
		frameRef.current?.contentWindow?.postMessage(
			{ payload: { ...payload, revision: revisionRef.current }, source: 'tk-acp-trace-bridge', type: 'lesson-state' },
			'*',
		);
	};

	useEffect(() => {
		readyRef.current = false;
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frameRef.current?.contentWindow) return;
			if (event.data?.type === 'lesson-preview-ready') {
				readyRef.current = true;
				send();
			} else if (event.data?.type === OPEN_ARTIFACT_REQUEST) {
				// The same answer TutorialKit's bridge gives: resolve, then reply to the frame that asked.
				answerOpenRequest(resolverRef.current, event.data).then((reply) => frameRef.current?.contentWindow?.postMessage(reply, '*'));
			} else if (event.data?.type === 'acp-trace-suggestion-accepted') {
				onAccepted?.(Boolean(event.data.accepted));
			}
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [html]);

	useEffect(send, [payload]);

	return (
		<iframe
			ref={frameRef}
			title={label}
			srcDoc={html}
			style={{ width: '100%', height, border: '1px solid #d8d4c8', background: '#fffdf8' }}
		/>
	);
}

export default function AcpTracePreview({ payload, height = 360, evidence }: Props) {
	const resolver = useMemo(() => (evidence ? new BundleArtifactResolver(evidence) : null), [evidence]);
	// The Client pane reports when the viewer accepts the agent's suggestion; the
	// Agent pane holds the finding back until then. Both still get the same trace.
	const [accepted, setAccepted] = useState(false);
	const agentPayload = useMemo(
		() => (payload ? ({ ...payload, accepted } as AcpTraceState) : payload),
		[payload, accepted],
	);

	// Both pages now announce `lesson-preview-ready` themselves (see
	// acp-trace/server.cjs), the same handshake otel-warm-log's own page uses
	// -- no Storybook-only shim needed to fake that signal anymore.
	return (
		<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
			<div>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Client</div>
				<Pane html={clientPageHtml} payload={payload} height={height} label="acp-trace client preview" onAccepted={setAccepted} resolver={resolver} />
			</div>
			<div>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Agent</div>
				<Pane html={agentPageHtml} payload={agentPayload} height={height} label="acp-trace agent preview" />
			</div>
		</div>
	);
}
