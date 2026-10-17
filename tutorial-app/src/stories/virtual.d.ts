declare module 'virtual:otel-warm-log-page' {
	const html: string;
	export default html;
}

declare module 'virtual:acp-trace-client-page' {
	const html: string;
	export default html;
}

declare module 'virtual:acp-trace-agent-page' {
	const html: string;
	export default html;
}

declare module 'js-yaml' {
	export function load(input: string): unknown;
}

declare module '*?worker' {
	const WorkerConstructor: new () => Worker;
	export default WorkerConstructor;
}

declare module '*?raw' {
	const text: string;
	export default text;
}
