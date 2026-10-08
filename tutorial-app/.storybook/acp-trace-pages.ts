import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Same "lift the page out of the real server.cjs" trick as
// otel-warm-log-page.ts, doubled: acp-trace's server.cjs exports both
// renderClientPage() and renderAgentPage() from one file, one per preview
// pane, so both virtual modules below evaluate the same source once.
const CLIENT_VIRTUAL_ID = 'virtual:acp-trace-client-page';
const AGENT_VIRTUAL_ID = 'virtual:acp-trace-agent-page';
const serverPath = fileURLToPath(new URL('../src/templates/acp-trace/server.cjs', import.meta.url));

function renderTemplatePages(): { client: string; agent: string } {
	const realRequire = createRequire(serverPath);
	const source = `${readFileSync(serverPath, 'utf8')}\nmodule.exports = { renderClientPage, renderAgentPage };`;
	const stubbedRequire = (id: string) =>
		id === 'node:http' ? { createServer: () => ({ listen() {} }) } : realRequire(id);
	const mod: { exports: { renderClientPage?: () => string; renderAgentPage?: () => string } } = {
		exports: {},
	};

	new Function('require', 'module', 'exports', source)(stubbedRequire, mod, mod.exports);

	if (!mod.exports.renderClientPage || !mod.exports.renderAgentPage) {
		throw new Error(`renderClientPage()/renderAgentPage() not found in ${serverPath}`);
	}

	return { client: mod.exports.renderClientPage(), agent: mod.exports.renderAgentPage() };
}

export function acpTracePages(): Plugin {
	return {
		name: 'acp-trace-pages',
		resolveId(id) {
			if (id === CLIENT_VIRTUAL_ID) return `\0${CLIENT_VIRTUAL_ID}`;
			if (id === AGENT_VIRTUAL_ID) return `\0${AGENT_VIRTUAL_ID}`;
			return undefined;
		},
		load(id) {
			if (id !== `\0${CLIENT_VIRTUAL_ID}` && id !== `\0${AGENT_VIRTUAL_ID}`) return undefined;
			this.addWatchFile(serverPath);
			const pages = renderTemplatePages();
			const html = id === `\0${CLIENT_VIRTUAL_ID}` ? pages.client : pages.agent;
			return `export default ${JSON.stringify(html)};`;
		},
	};
}
