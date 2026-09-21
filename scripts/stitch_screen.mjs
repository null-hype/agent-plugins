#!/usr/bin/env node

/**
 * Storyboard Screen Stitch SDK Integration (CIT-205)
 * 
 * Uses @google/stitch-sdk to manage Stitch storyboard projects, generate screens
 * from checked-in prompt files (scripts/stitch/<name>.prompt.md), and extract
 * HTML and screenshot assets into docs/storyboards/<name>/.
 * 
 * Invocation:
 *   pass-cli run --env-file .env -- node scripts/stitch_screen.mjs <name> [info|generate|download]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// CLI Arguments
const name = process.argv[2];
const action = process.argv[3] || 'info';

if (!name || name === '--help' || name === '-h') {
	console.log('Usage: node scripts/stitch_screen.mjs <name> [info|generate|download]');
	console.log('Available storyboard screens: precog-board, follower-maze');
	process.exit(name ? 0 : 1);
}

const OUTPUT_DIR = path.join(REPO_ROOT, 'docs', 'storyboards', name);
const PROMPT_FILE = path.join(REPO_ROOT, 'scripts', 'stitch', `${name}.prompt.md`);

// Import stitch from tutorial-app's node_modules
const stitchModulePath = path.join(REPO_ROOT, 'tutorial-app', 'node_modules', '@google', 'stitch-sdk', 'dist', 'src', 'index.js');

if (!fs.existsSync(stitchModulePath)) {
	console.error('Error: @google/stitch-sdk is not installed in tutorial-app/node_modules.');
	console.error('Run: npm --prefix tutorial-app install');
	process.exit(1);
}

const { stitch } = await import(stitchModulePath);

function loadMetadata(screenName, outputDir) {
	const metaPath = path.join(outputDir, 'stitch-metadata.json');
	if (fs.existsSync(metaPath)) {
		try {
			return { meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')), path: metaPath };
		} catch {
			// ignore parse error
		}
	}

	// Backward compatibility fallback for precog-board
	if (screenName === 'precog-board') {
		const legacyMetaPath = path.join(REPO_ROOT, 'docs', 'precog', 'stitch-metadata.json');
		if (fs.existsSync(legacyMetaPath)) {
			try {
				return { meta: JSON.parse(fs.readFileSync(legacyMetaPath, 'utf8')), path: legacyMetaPath };
			} catch {
				// ignore parse error
			}
		}
	}

	return { meta: null, path: metaPath };
}

const { meta: existingMeta } = loadMetadata(name, OUTPUT_DIR);
const PROJECT_ID = process.env.STITCH_PROJECT_ID || existingMeta?.projectId || '6209586202936672661';

async function getOrInitProject() {
	if (!process.env.STITCH_API_KEY) {
		console.error('Error: STITCH_API_KEY is not set in environment.');
		console.error(`Run via: pass-cli run --env-file .env -- node scripts/stitch_screen.mjs ${name} ${action}`);
		process.exit(1);
	}

	try {
		const project = stitch.project(PROJECT_ID);
		return project;
	} catch (err) {
		console.log('Project not found or error loading project. Creating new project...');
		const projectTitle = name === 'follower-maze'
			? 'Follower Maze — Ordered Routing'
			: (name === 'precog-board'
				? 'Pre-cog Board — Sealed Capability Predictions'
				: `Storyboard — ${name}`);
		const created = await stitch.callTool('create_project', {
			title: projectTitle,
		});
		console.log('Created project:', created.name);
		const newId = created.name.replace('projects/', '');
		return stitch.project(newId);
	}
}

async function cmdInfo() {
	console.log(`Checking Stitch project ID: ${PROJECT_ID}...`);
	if (process.env.STITCH_API_KEY) {
		try {
			const projectDetails = await stitch.callTool('get_project', { name: `projects/${PROJECT_ID}` });
			console.log(`Project: ${projectDetails.title} (${projectDetails.name})`);
			console.log(`Origin: ${projectDetails.origin}, Visibility: ${projectDetails.visibility}`);
		} catch (err) {
			console.warn(`Warning: Could not fetch project details from Stitch: ${err.message}`);
		}
	} else {
		console.log('(STITCH_API_KEY not set in environment; skipping live Stitch API query)');
	}

	const { meta, path: metaPath } = loadMetadata(name, OUTPUT_DIR);
	if (meta) {
		console.log(`Active Screen from metadata (${metaPath}):`);
		console.log(`  - ID: ${meta.screenId}`);
		console.log(`  - Title: ${meta.title}`);
		console.log(`  - HTML: ${meta.htmlUrl}`);
		console.log(`  - Image: ${meta.imageUrl}`);
	} else {
		console.log(`No active screen metadata found at ${metaPath}`);
	}
}

async function cmdGenerate() {
	if (!fs.existsSync(PROMPT_FILE)) {
		console.error(`Error: Prompt file not found at ${PROMPT_FILE}`);
		process.exit(1);
	}
	const prompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();

	console.log(`Connecting to Stitch project ID: ${PROJECT_ID}...`);
	const project = await getOrInitProject();

	console.log(`Generating screen on Stitch via generate_screen_from_text for ${name}...`);
	const screen = await project.generate(prompt, 'DESKTOP');
	console.log(`Screen generated successfully: ${screen.id}`);

	await downloadScreenAssets(screen);
}

async function downloadScreenAssets(screen) {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	const htmlUrl = await screen.getHtml();
	const imgUrl = await screen.getImage();

	console.log(`Fetching HTML from ${htmlUrl}...`);
	const htmlRes = await fetch(htmlUrl);
	const htmlText = await htmlRes.text();
	const htmlPath = path.join(OUTPUT_DIR, `${name}-screen.html`);
	fs.writeFileSync(htmlPath, htmlText);
	console.log(`Saved HTML to ${htmlPath} (${htmlText.length} bytes)`);

	if (imgUrl) {
		console.log(`Fetching Screenshot from ${imgUrl}...`);
		const imgRes = await fetch(imgUrl);
		const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
		const imgPath = path.join(OUTPUT_DIR, `${name}-screenshot.png`);
		fs.writeFileSync(imgPath, imgBuffer);
		console.log(`Saved screenshot to ${imgPath} (${imgBuffer.length} bytes)`);
	}

	const metadata = {
		projectId: PROJECT_ID,
		screenId: screen.id,
		title: screen.title || `${name} Storyboard`,
		htmlUrl,
		imageUrl: imgUrl,
		updatedAt: new Date().toISOString(),
	};
	const metaPath = path.join(OUTPUT_DIR, 'stitch-metadata.json');
	fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
	console.log(`Saved metadata to ${metaPath}`);
}

async function cmdDownload() {
	const project = await getOrInitProject();
	const screens = await project.screens();
	if (screens.length === 0) {
		console.log('No screens found in project to download.');
		return;
	}

	const { meta } = loadMetadata(name, OUTPUT_DIR);
	let screen = null;
	if (meta?.screenId) {
		screen = screens.find((s) => s.id === meta.screenId);
	}
	if (!screen) {
		screen = screens[0];
	}

	console.log(`Downloading screen ${screen.id} for ${name}...`);
	await downloadScreenAssets(screen);
}

// CLI Dispatch
switch (action) {
	case 'info':
		await cmdInfo();
		break;
	case 'generate':
		await cmdGenerate();
		break;
	case 'download':
		await cmdDownload();
		break;
	default:
		console.log(`Unknown action: ${action}`);
		console.log(`Usage: node scripts/stitch_screen.mjs ${name} [info|generate|download]`);
		process.exit(1);
}
