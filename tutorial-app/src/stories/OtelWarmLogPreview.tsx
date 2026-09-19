import React, { useEffect, useMemo, useRef } from 'react';
import pageHtml from 'virtual:otel-warm-log-page';

// What RuleTraceBridge / LoanwordArcBridge post to the preview frame.
export type LessonStatePayload = {
	previewMode?: 'blocked-until-valid' | 'static-log-with-completion';
	previewState?: string;
	scenario?: string;
	solved?: boolean;
	storyFile?: string;
};

type Props = {
	// Omit to show the page's own boot state (what a reason-log lesson shows).
	payload?: LessonStatePayload;
	source?: 'tk-rule-trace-bridge' | 'tk-loanword-arc-bridge';
	// Files the page fetches from TutorialKit's /__tk/file endpoint, by path.
	fixtures?: Record<string, string>;
	height?: number;
};

const FILE_ENDPOINT = '/__tk/file?path=';
const NO_FIXTURES: Record<string, string> = {};

// The page fetches lesson files over HTTP from the WebContainer's server.
// There is none here, so answer those fetches from `fixtures` instead.
function buildSrcDoc(fixtures: Record<string, string>): string {
	const shim = `<script>
(() => {
  const fixtures = ${JSON.stringify(fixtures).replace(/</g, '\\u003c')};
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith(${JSON.stringify(FILE_ENDPOINT)})) return realFetch(input, init);
    const body = fixtures[decodeURIComponent(url.slice(${FILE_ENDPOINT.length}))];
    return Promise.resolve(
      body === undefined ? new Response('Not found', { status: 404 }) : new Response(body),
    );
  };
})();
</script>`;

	return pageHtml.replace('<head>', `<head>${shim}`);
}

export default function OtelWarmLogPreview({
	payload,
	source = 'tk-rule-trace-bridge',
	fixtures = NO_FIXTURES,
	height = 420,
}: Props) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const readyRef = useRef(false);
	const revisionRef = useRef(0);
	const srcDoc = useMemo(() => buildSrcDoc(fixtures), [fixtures]);

	const send = () => {
		if (!payload || !readyRef.current) return;
		revisionRef.current += 1;
		frameRef.current?.contentWindow?.postMessage(
			{ payload: { ...payload, revision: revisionRef.current }, source, type: 'lesson-state' },
			'*',
		);
	};

	// The page announces itself once its listener is installed.
	useEffect(() => {
		readyRef.current = false;
		const onMessage = (event: MessageEvent) => {
			if (
				event.source === frameRef.current?.contentWindow &&
				event.data?.type === 'lesson-preview-ready'
			) {
				readyRef.current = true;
				send();
			}
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [srcDoc]);

	// Re-post when a control changes the payload after the page is ready.
	useEffect(send, [payload, source]);

	return (
		<iframe
			ref={frameRef}
			title="otel-warm-log preview"
			srcDoc={srcDoc}
			style={{ width: '100%', height, border: '1px solid #d8d4c8', background: '#fffdf8' }}
		/>
	);
}
