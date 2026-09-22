import React, { useEffect, useRef } from 'react';
import clientPageHtml from 'virtual:acp-trace-client-page';
import agentPageHtml from 'virtual:acp-trace-agent-page';
import type { AcpTraceState } from '../lib/acpTraceProtocol';

type Props = {
	payload?: AcpTraceState;
	height?: number;
};

// Mirrors OtelWarmLogPreview's shape (payload -> postMessage once each iframe
// announces readiness), but for acp-trace's two independent pages instead of
// one -- both receive the exact same payload, which is what makes "both
// previews agree on the visible trace position" true by construction rather
// than by coordination.
function Pane({ html, payload, height, label }: { html: string; payload?: AcpTraceState; height: number; label: string }) {
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
			if (event.source === frameRef.current?.contentWindow && event.data?.type === 'lesson-preview-ready') {
				readyRef.current = true;
				send();
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

export default function AcpTracePreview({ payload, height = 360 }: Props) {
	// Both pages now announce `lesson-preview-ready` themselves (see
	// acp-trace/server.cjs), the same handshake otel-warm-log's own page uses
	// -- no Storybook-only shim needed to fake that signal anymore.
	return (
		<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
			<div>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Client</div>
				<Pane html={clientPageHtml} payload={payload} height={height} label="acp-trace client preview" />
			</div>
			<div>
				<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Agent</div>
				<Pane html={agentPageHtml} payload={payload} height={height} label="acp-trace agent preview" />
			</div>
		</div>
	);
}
