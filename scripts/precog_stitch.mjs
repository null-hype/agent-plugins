#!/usr/bin/env node

/**
 * Pre-cog Board Stitch SDK Integration (CIT-199)
 * 
 * Uses @google/stitch-sdk to create and manage the Pre-cog board UI project,
 * generate screens from capability reconciliation storyboards, and extract
 * HTML and screenshot assets programmatically.
 * 
 * Invocation:
 *   pass-cli run --env-file .env -- node scripts/precog_stitch.mjs [generate|download|info]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'docs', 'precog');

// Import stitch from tutorial-app's node_modules
const stitchModulePath = path.join(REPO_ROOT, 'tutorial-app', 'node_modules', '@google', 'stitch-sdk', 'dist', 'src', 'index.js');

if (!fs.existsSync(stitchModulePath)) {
	console.error('Error: @google/stitch-sdk is not installed in tutorial-app/node_modules.');
	console.error('Run: npm --prefix tutorial-app install');
	process.exit(1);
}

const { stitch } = await import(stitchModulePath);

const PROJECT_ID = process.env.STITCH_PROJECT_ID || '6209586202936672661';

async function getOrInitProject() {
	if (!process.env.STITCH_API_KEY) {
		console.error('Error: STITCH_API_KEY is not set in environment.');
		console.error('Run via: pass-cli run --env-file .env -- node scripts/precog_stitch.mjs');
		process.exit(1);
	}

	try {
		const project = stitch.project(PROJECT_ID);
		return project;
	} catch (err) {
		console.log('Project not found or error loading project. Creating new project...');
		const created = await stitch.callTool('create_project', {
			title: 'Pre-cog Board — Sealed Capability Predictions',
		});
		console.log('Created project:', created.name);
		const newId = created.name.replace('projects/', '');
		return stitch.project(newId);
	}
}

async function cmdInfo() {
	console.log(`Checking Stitch project ID: ${PROJECT_ID}...`);
	const projectDetails = await stitch.callTool('get_project', { name: `projects/${PROJECT_ID}` });
	console.log(`Project: ${projectDetails.title} (${projectDetails.name})`);
	console.log(`Origin: ${projectDetails.origin}, Visibility: ${projectDetails.visibility}`);
	
	const metaPath = path.join(OUTPUT_DIR, 'stitch-metadata.json');
	if (fs.existsSync(metaPath)) {
		const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
		console.log(`Active Screen from metadata:`);
		console.log(`  - ID: ${meta.screenId}`);
		console.log(`  - Title: ${meta.title}`);
		console.log(`  - HTML: ${meta.htmlUrl}`);
		console.log(`  - Image: ${meta.imageUrl}`);
	}
}

async function cmdGenerate() {
	console.log(`Connecting to Stitch project ID: ${PROJECT_ID}...`);
	const project = await getOrInitProject();

	const prompt = [
		'A developer tool interface for a Pre-cog board in an IDE dark theme.',
		'The board reconciles sealed capability predictions against Proton Pass agent monitor access logs.',
		'Top status bar shows: 0 sealed · 1 done · 1 stale · 1 alarm and -- run ended --.',
		'Left column: Pre-cog Board showing pre-registered capability predictions in Pkl format:',
		'  - L1 deploy · ci/deploy-key (DONE green badge, predicted and observed)',
		'  - L2 migrate · prod/db-admin (STALE amber badge, predicted never observed)',
		'  - ALARM row !! rotate · prod/db-admin (NOT PREDICTED red badge) with hover card: "same target as L2, different purpose" and repair buttons: [change world] [change model] [change axiom]',
		'Right column: Pass Agent Monitor Log showing timestamped entries:',
		'  - deploy staging · ci/deploy-key (matched L1)',
		'  - rotate token · prod/db-admin (unpredicted divergence)',
		'Bottom bar: ACP plan_update broadcast showing items with _stale and _unpredicted status.',
	].join(' ');

	console.log('Generating screen on Stitch via generate_screen_from_text...');
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
	const htmlPath = path.join(OUTPUT_DIR, 'precog-board-screen.html');
	fs.writeFileSync(htmlPath, htmlText);
	console.log(`Saved HTML to ${htmlPath} (${htmlText.length} bytes)`);

	if (imgUrl) {
		console.log(`Fetching Screenshot from ${imgUrl}...`);
		const imgRes = await fetch(imgUrl);
		const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
		const imgPath = path.join(OUTPUT_DIR, 'precog-board-screenshot.png');
		fs.writeFileSync(imgPath, imgBuffer);
		console.log(`Saved screenshot to ${imgPath} (${imgBuffer.length} bytes)`);
	}

	const metadata = {
		projectId: PROJECT_ID,
		screenId: screen.id,
		title: screen.title || 'Pre-cog Board',
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
	const screen = screens[0];
	console.log(`Downloading latest screen ${screen.id}...`);
	await downloadScreenAssets(screen);
}

// CLI Dispatch
const action = process.argv[2] || 'info';

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
		console.log('Usage: node scripts/precog_stitch.mjs [info|generate|download]');
		process.exit(1);
}
