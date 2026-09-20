import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:otel-warm-log-page';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const serverPath = fileURLToPath(
	new URL('../src/templates/otel-warm-log/server.cjs', import.meta.url),
);

// server.cjs is a Node HTTP server whose renderPage() returns the whole
// Monaco preview page. Evaluate it with `node:http` stubbed out so nothing
// listens, and lift renderPage() out -- the story then renders the exact page
// the lesson ships, with no second copy to drift.
function renderTemplatePage(): string {
	const realRequire = createRequire(serverPath);
	const source = `${readFileSync(serverPath, 'utf8')}\nmodule.exports = { renderPage };`;
	const stubbedRequire = (id: string) =>
		id === 'node:http' ? { createServer: () => ({ listen() {} }) } : realRequire(id);
	const mod: { exports: { renderPage?: () => string } } = { exports: {} };

	new Function('require', 'module', 'exports', source)(stubbedRequire, mod, mod.exports);

	if (!mod.exports.renderPage) {
		throw new Error(`renderPage() not found in ${serverPath}`);
	}

	return mod.exports.renderPage();
}

export function otelWarmLogPage(): Plugin {
	return {
		name: 'otel-warm-log-page',
		resolveId(id) {
			return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
		},
		load(id) {
			if (id !== RESOLVED_ID) return undefined;
			this.addWatchFile(serverPath);
			return `export default ${JSON.stringify(renderTemplatePage())};`;
		},
	};
}
