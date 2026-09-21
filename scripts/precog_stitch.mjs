#!/usr/bin/env node

/**
 * Pre-cog Board Stitch SDK Integration Shim (CIT-205 / CIT-199)
 * 
 * Forwards to scripts/stitch_screen.mjs precog-board [action]
 * 
 * Invocation:
 *   pass-cli run --env-file .env -- node scripts/precog_stitch.mjs [info|generate|download]
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetScript = path.join(__dirname, 'stitch_screen.mjs');
const action = process.argv[2] || 'info';

const child = spawn(process.execPath, [targetScript, 'precog-board', action], {
	stdio: 'inherit',
	env: process.env,
});

child.on('exit', (code) => {
	process.exit(code ?? 0);
});
