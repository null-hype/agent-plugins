import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { parsePklError, type PklLocation } from '../tests/shared-model/pklError.ts';

export type { PklLocation };

// The shared model the "Shared model" stories review: one committed base, and
// a working copy per person, the way each would hold their own environment.
// Working copies live under node_modules/.cache, which Vite does not watch, so
// a save never reloads anyone's tab. Pkl evaluates every save through the
// `pkl` on PATH, as every other pipeline here; what it rejects comes back as
// its own error.
const base = fileURLToPath(new URL('../tests/shared-model/revisions/baseline/PrivateDocument.pkl', import.meta.url));
const workspace = fileURLToPath(new URL('../node_modules/.cache/shared-model/', import.meta.url));

export type Evaluation =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; message: string; locations: PklLocation[] };
export type SharedModel = { user: string; base: string; working: string; evaluation: Evaluation };

async function evaluate(path: string): Promise<Evaluation> {
	try {
		const { stdout } = await promisify(execFile)('pkl', ['eval', '-f', 'json', path]);
		return { ok: true, value: JSON.parse(stdout) };
	} catch (error) {
		return { ok: false, ...parsePklError(String((error as { stderr?: string }).stderr ?? error), 'PrivateDocument.pkl') };
	}
}

async function state(user: string): Promise<SharedModel> {
	const path = `${workspace}${user}/PrivateDocument.pkl`;
	const committed = await readFile(base, 'utf8');
	const working = await readFile(path, 'utf8').catch(async () => {
		await mkdir(`${workspace}${user}`, { recursive: true });
		await writeFile(path, committed);
		return committed;
	});
	return { user, base: committed, working, evaluation: await evaluate(path) };
}

export function sharedModel(): Plugin {
	return {
		name: 'shared-model',
		configureServer(server) {
			server.middlewares.use('/__shared-model', async (req, res) => {
				const url = new URL(req.url ?? '/', 'http://localhost');
				const send = (body: unknown) => {
					res.setHeader('content-type', 'application/json');
					res.end(JSON.stringify(body));
				};
				if (url.pathname === '/reset' && req.method === 'POST') {
					await rm(workspace, { recursive: true, force: true });
					return send({ reset: true });
				}
				const user = url.searchParams.get('user') ?? '';
				if (!/^[a-z]+$/.test(user)) {
					res.statusCode = 400;
					return send({ error: 'user must be a lowercase name' });
				}
				if (req.method === 'PUT') {
					let body = '';
					for await (const chunk of req) body += chunk;
					await state(user);
					await writeFile(`${workspace}${user}/PrivateDocument.pkl`, body);
				}
				send(await state(user));
			});
		},
	};
}
