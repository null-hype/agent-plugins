import React, { useEffect, useMemo, useRef, useState } from 'react';
import clientPageHtml from 'virtual:acp-trace-client-page';
import agentPageHtml from 'virtual:acp-trace-agent-page';
import type { AcpTraceState } from '../lib/acpTraceProtocol';

type Props = {
	payload?: AcpTraceState;
	height?: number;
	/** False for lessons that run the Client alone (part 5: agent activity is a terminal). */
	agent?: boolean;
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
}: {
	html: string;
	payload?: AcpTraceState;
	height: number;
	label: string;
	onAccepted?: (accepted: boolean, recordingId: unknown, order: unknown) => void;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
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
			} else if (event.data?.type === 'acp-trace-suggestion-accepted') {
				onAccepted?.(Boolean(event.data.accepted), event.data.recordingId, event.data.order);
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

export default function AcpTracePreview({ payload, height = 360, agent = true }: Props) {
	// As AcpTraceBridge does: the Client reports which suggestions the viewer
	// accepted, per recording and in order, and both panes get that back. The
	// coarse flag alone let one accepted question reveal every finding.
	const [accepted, setAccepted] = useState(false);
	const [acceptedReviews, setAcceptedReviews] = useState<Record<string, number[]>>({});
	const onAccepted = (flag: boolean, recordingId: unknown, order: unknown) => {
		setAccepted(flag);
		if (typeof recordingId === 'string' && Array.isArray(order) && order.every((index) => Number.isInteger(index) && index >= 0)) {
			setAcceptedReviews((previous) => ({ ...previous, [recordingId]: order }));
		}
	};
	const clientPayload = useMemo(
		() => (payload ? ({ ...payload, acceptedReviews } as AcpTraceState) : payload),
		[payload, acceptedReviews],
	);
	const agentPayload = useMemo(
		() => (payload ? ({ ...payload, acceptedReviews, accepted } as AcpTraceState) : payload),
		[payload, acceptedReviews, accepted],
	);

	// Both pages now announce `lesson-preview-ready` themselves (see
	// acp-trace/server.cjs), the same handshake otel-warm-log's own page uses
	// -- no Storybook-only shim needed to fake that signal anymore.
	return (
		<div style={{ display: 'grid', gridTemplateColumns: agent ? '1fr 1fr' : '1fr', gap: 12 }}>
			<div>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Client</div>
				<Pane html={clientPageHtml} payload={clientPayload} height={height} label="acp-trace client preview" onAccepted={onAccepted} />
			</div>
			{agent && (
				<div>
					<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Agent</div>
					<Pane html={agentPageHtml} payload={agentPayload} height={height} label="acp-trace agent preview" />
				</div>
			)}
		</div>
	);
}
