import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { deriveTraceView } from '../lib/acpTraceProtocol';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, loadLesson } from './lessonFixtures';

// `solved` is a control-only arg -- it doesn't flow into AcpTracePreview's
// own props directly, render() derives `payload` from it each time. So meta
// is typed against this story-level args shape rather than `typeof
// AcpTracePreview`, whose real props (payload/height) aren't what the
// Controls panel is meant to drive here.
//
// This chapter's docs page (Storybook autodocs) embeds all three lessons'
// stories on one page at once, unlike every other lesson which is only ever
// viewed one at a time (Canvas). That ruled out AcpTraceBridge + the
// Storybook tutorialkit-store stub here: the bridge posts its state to
// *every* `.previews-container iframe` in the whole document
// (AcpTraceBridge.tsx's getPreviewFrames(), correct for the real app where
// exactly one lesson is ever mounted, wrong once three are mounted
// together), and the store stub is a module-level singleton, so three
// concurrent `beforeEach` seeds collapse to whichever ran last -- confirmed
// live, every embedded preview on the docs page showed lesson 3's state.
// `deriveAcpTraceState` (same derivation AcpTraceBridge itself calls) plus
// AcpTracePreview's own `payload` prop sidesteps both: each Pane posts only
// to its own iframe ref, and payload is computed fresh per story/per
// `solved` toggle with no shared mutable state at all.
type StoryArgs = { solved: boolean; frameId?: string };

// Explicit annotation rather than `satisfies Meta<StoryArgs>` -- `satisfies`
// keeps the narrower literal type of the object itself, which has no
// `component`, and StoryObj's Args extraction falls back to `{}` without
// one. Annotating with the Meta<StoryArgs> type directly makes `typeof meta`
// resolve to that, so beforeEach/play's `args` come through typed.
const meta: Meta<StoryArgs> = {
	title: 'Lessons/Composition Review (Concept Storyboard)',
	id: 'lessons-smuggling-survives-the-merge',
	// docs.story.autoplay: false -- play() checks the visible replay verdicts; keeping it off still avoids firing
	// that wait the instant a reader scrolls a story into view on the
	// autodocs page. The Canvas view (a story opened on its own) is
	// unaffected -- Storybook always autoplays there.
	parameters: { layout: 'padded', docs: { story: { autoplay: false } } },
	// `solved` replaces the old step()-narrated solve() call: toggle it in
	// the Controls panel to see the lesson's starter vs. solved state. This
	// is a stepping stone -- solve() jumps straight to the end of the
	// interaction, and the play() functions will grow back into narrating
	// the path there once we're iterating on them again.
	argTypes: {
		solved: { control: 'boolean' },
		// All three lessons' fixtures are split into frame-{id}.json files.
		// An id that doesn't match the current lesson's own frameIds is
		// ignored -- see resolveAcpTraceFixture's graceful fallback.
		frameId: { control: 'text' },
	},
	args: {
		solved: false,
		frameId: undefined,
	},
};

export default meta;

type Story = StoryObj<typeof meta>;

const lesson1 = loadLesson('part-4/smuggling-survives-the-merge/1-two-patches-reviewed-independently');
const lesson2 = loadLesson('part-4/smuggling-survives-the-merge/2-gitbutler-applies-both');
const lesson3 = loadLesson('part-4/smuggling-survives-the-merge/3-bootstrap-finds-it-reopened');

// Duplicated from AcpTrace.stories.tsx (not exported there -- see that
// file's own comment on why a copy rather than a shared source of truth):
// the Client/Agent panes are Monaco editors inside iframes, so a play()
// function reads their rendered text straight out of each frame's own
// .monaco-editor DOM rather than through Storybook's `canvas` queries.
const editorsReady = (canvasElement: HTMLElement) =>
	waitFor(
		() => {
			const frames = Array.from(canvasElement.querySelectorAll('iframe'));
			if (frames.length < 2) throw new Error('expected two preview iframes (client, agent)');
			for (const frame of frames) {
				if (!frame.contentDocument?.querySelector('.monaco-editor .view-line')) {
					throw new Error('Monaco has not rendered in every pane yet');
				}
			}
		},
		{ timeout: 15000 },
	);

const clientText = (canvasElement: HTMLElement) =>
	(
		canvasElement.querySelectorAll('iframe')[0]?.contentDocument?.querySelector('.monaco-editor .view-lines')
			?.textContent ?? ''
	).replace(/ /g, ' ');

// Unlike AcpTrace.stories.tsx's ghost-trace lessons -- which never carry
// pins or a verdict, so the Agent pane's Monaco JSON dump stays visible
// throughout -- this scenario's frames do carry both, so CIT-251's
// reasoning view (#trace-view) takes over and server.cjs's own CSS sets
// `main.agent.reasoning #monaco-root { display: none }`. A hidden Monaco
// container stops laying out new content (readable proof: agentText()
// alone gets stuck reporting the pre-hide "{" forever, not just briefly),
// so once the reasoning view is showing, that -- not Monaco -- is the pane's
// actual visible text.
const agentText = (canvasElement: HTMLElement) => {
	const doc = canvasElement.querySelectorAll('iframe')[1]?.contentDocument;
	const traceView = doc?.querySelector<HTMLElement>('#trace-view');
	if (traceView && !traceView.hidden) return (traceView.textContent ?? '').replace(/ /g, ' ');
	return (doc?.querySelector('.monaco-editor .view-lines')?.textContent ?? '').replace(/ /g, ' ');
};

// Tier 1 (see AcpTrace.stories.tsx's own Tier 1 section): payload derived
// straight from the lesson's files via the protocol library, same as
// AcpTraceBridge itself does internally -- no store, no bridge. `solved` is
// a Controls-panel toggle rather than a narrated play(); flip it to compare
// the lesson's starter and solved states. play() itself just waits for both
// panes to render and checks their verdicts.
//
// height: 640 -- default 360 is too short once the Agent pane's raw JSON
// dump is a single long word-wrapped line (this lesson's pin text is long);
// see AcpTrace.stories.tsx's Lesson2StartsFromLesson1Solved for the same fix
// and the fuller explanation of why a short pane silently truncates any
// textContent read to whatever's actually in the viewport.
export const TwoPatchesReviewedIndependently: Story = {
	name: 'Two hypothetical reviews',
	render: (args) => (
		<div className="previews-container">
			<AcpTracePreview
				payload={deriveAcpTraceState(
					lesson1,
					args.solved || args.frameId ? lesson1.solved : lesson1.files,
					{ frameId: args.frameId },
				)}
				height={640}
			/>
		</div>
	),
	play: async ({ canvasElement, args }) => {
		await editorsReady(canvasElement);
		const state = deriveAcpTraceState(lesson1, args.solved || args.frameId ? lesson1.solved : lesson1.files, { frameId: args.frameId });
		const view = deriveTraceView(state.frames);
		await waitFor(() => {
			for (const entries of Object.values(view.channels)) {
				for (const entry of entries) expect(agentText(canvasElement)).toContain(entry.text);
			}
			expect(clientText(canvasElement)).toContain(state.frames.some((frame) => 'rebaseTodo' in frame) ? 'pick ' : 'waiting for trace');
		}, { timeout: 15000 });
	},
};

export const GitButlerAppliesBoth: Story = {
	name: 'An illustrative clean merge',
	render: (args) => (
		<div className="previews-container">
			<AcpTracePreview
				payload={deriveAcpTraceState(
					lesson2,
					args.solved || args.frameId ? lesson2.solved : lesson2.files,
					{ frameId: args.frameId },
				)}
				height={640}
			/>
		</div>
	),
	play: async ({ canvasElement, args }) => {
		await editorsReady(canvasElement);
		const state = deriveAcpTraceState(lesson2, args.solved || args.frameId ? lesson2.solved : lesson2.files, { frameId: args.frameId });
		const view = deriveTraceView(state.frames);
		await waitFor(() => {
			for (const entries of Object.values(view.channels)) {
				for (const entry of entries) expect(agentText(canvasElement)).toContain(entry.text);
			}
			expect(clientText(canvasElement)).toContain(state.frames.some((frame) => 'rebaseTodo' in frame) ? 'pick ' : 'waiting for trace');
		}, { timeout: 15000 });
	},
};

export const BootstrapFindsItReopened: Story = {
	name: 'The merged experiment has not run',
	render: (args) => (
		<div className="previews-container">
			<AcpTracePreview
				payload={deriveAcpTraceState(
					lesson3,
					args.solved || args.frameId ? lesson3.solved : lesson3.files,
					{ frameId: args.frameId },
				)}
				height={640}
			/>
		</div>
	),
	play: async ({ canvasElement, args }) => {
		await editorsReady(canvasElement);
		const state = deriveAcpTraceState(lesson3, args.solved || args.frameId ? lesson3.solved : lesson3.files, { frameId: args.frameId });
		const view = deriveTraceView(state.frames);
		await waitFor(() => {
			for (const entries of Object.values(view.channels)) {
				for (const entry of entries) expect(agentText(canvasElement)).toContain(entry.text);
			}
			expect(clientText(canvasElement)).toContain(state.frames.some((frame) => 'rebaseTodo' in frame) ? 'pick ' : 'waiting for trace');
		}, { timeout: 15000 });
	},
};
