import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import AcpTracePreview from './AcpTracePreview';
import AcpTraceBridge from '../components/AcpTraceBridge';
import { deriveAcpTraceState, loadLesson } from './lessonFixtures';
import tutorialStore, { resetTutorialStore, seedTutorialStore } from '../../.storybook/tutorialkit-store';

const meta = {
	title: 'Lessons/ACP Trace (Ghost Trace Machine)',
	component: AcpTracePreview,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof AcpTracePreview>;

export default meta;

type Story = StoryObj<typeof meta>;

const lesson = loadLesson('part-2/chapter-1/lesson-1');
const lesson2 = loadLesson('part-2/chapter-1/lesson-2');

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

const agentText = (canvasElement: HTMLElement) =>
	(
		canvasElement.querySelectorAll('iframe')[1]?.contentDocument?.querySelector('.monaco-editor .view-lines')
			?.textContent ?? ''
	).replace(/ /g, ' ');

const expectClientShows = (canvasElement: HTMLElement, needle: string) =>
	waitFor(() => {
		const text = clientText(canvasElement);
		if (!text.includes(needle)) throw new Error(`client pane does not show "${needle}"; it shows: ${text.slice(0, 300)}`);
	});

const expectAgentShows = (canvasElement: HTMLElement, needle: string) =>
	waitFor(() => {
		const text = agentText(canvasElement);
		if (!text.includes(needle)) throw new Error(`agent pane does not show "${needle}"; it shows: ${text.slice(0, 300)}`);
	});

// -- Tier 1: payload derived by the lesson's protocol library ---------------

// The starter file: the client request sent, the agent's turn blocked.
export const Blocked: Story = {
	args: { payload: deriveAcpTraceState(lesson, lesson.files) },
	play: async ({ canvasElement }) => {
		await editorsReady(canvasElement);
		await expectClientShows(canvasElement, 'client: send prompt  ->  sent  session/prompt');
		await expectClientShows(canvasElement, "Why didn't user 10 get the status update");
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)');
		await expect(clientText(canvasElement)).not.toContain('fm-missing-delivery');
		await expectAgentShows(canvasElement, 'session/prompt');
		await expect(agentText(canvasElement)).not.toContain('diagnostic');
	},
};

// The solution file: the agent's diagnostic reply revealed, in both panes --
// as a real Monaco marker + CodeLens (CIT-247), not a plain printed line.
export const Solved: Story = {
	args: { payload: deriveAcpTraceState(lesson, lesson.solved) },
	play: async ({ canvasElement }) => {
		await editorsReady(canvasElement);
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  fm-missing-delivery');
		await expectAgentShows(canvasElement, '"code":"fm-missing-delivery"');

		const doc = canvasElement.querySelectorAll('iframe')[0]?.contentDocument;
		await waitFor(() => {
			if (!doc?.querySelector('.codelens-decoration')) {
				throw new Error('diagnostic CodeLens has not rendered yet');
			}
		});

		const lens = Array.from(doc!.querySelectorAll<HTMLElement>('.codelens-decoration a')).find((a) =>
			a.textContent?.includes('fm-missing-delivery'),
		);
		if (!lens) throw new Error('fm-missing-delivery CodeLens not found');

		const win = doc!.defaultView!;
		for (const type of ['mousedown', 'mouseup', 'click']) {
			lens.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
		}

		await waitFor(() => {
			const text = doc!.querySelector('.evidence-widget')?.textContent ?? '';
			for (const needle of ['fixtures/arrivals/4231.json', 'witness/arrival-order', 'followerMaze.orderedRouting']) {
				if (!text.includes(needle)) throw new Error('evidence widget missing ' + needle);
			}
		});
	},
};

// -- Tier 2: the real bridge drives both pages, Solve is a real click -------

// AcpTraceBridge reads /acp-trace.json from the store, builds the state with
// acpTraceProtocol, and broadcasts it to both preview iframes. It is headless
// (CIT-251): Solve/Reset are TutorialKit's own editor controls, which call the
// store's solve()/reset() (the `_files` -> `_solution` swap) -- this story
// calls those same store methods.
export const ViaBridge: Story = {
	render: () => (
		<>
			<AcpTraceBridge />
			<div className="previews-container">
				<AcpTracePreview />
			</div>
		</>
	),
	beforeEach: () => {
		seedTutorialStore({ data: lesson.data, files: lesson.files, solution: lesson.solved });
		return resetTutorialStore;
	},
	play: async ({ canvasElement, step }) => {
		await step('starter file: agent turn blocked in both panes', async () => {
			await editorsReady(canvasElement);
			await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)');
			await expectAgentShows(canvasElement, 'session/prompt');
			await expect(agentText(canvasElement)).not.toContain('diagnostic');
		});

		// CIT-246: a preview that joins late -- a slow WebContainer boot, or a
		// learner reloading the pane -- must still land on the *current* trace
		// position via its own `lesson-preview-ready` announcement, not a timed
		// resend that may have already stopped. Reloading re-runs the page's
		// script, which re-registers its listener and re-announces readiness;
		// AcpTraceBridge answers that announcement directly, same as a fresh boot.
		await step('reload before Solve: a late-joining preview still shows the blocked state', async () => {
			const agentFrame = canvasElement.querySelectorAll('iframe')[1] as HTMLIFrameElement;
			agentFrame.contentWindow?.location.reload();
			await editorsReady(canvasElement);
			await expectAgentShows(canvasElement, 'session/prompt');
			await expect(agentText(canvasElement)).not.toContain('diagnostic');
		});

		await step('Solve: both panes reveal the same recorded diagnostic', async () => {
			tutorialStore.solve();
			await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  fm-missing-delivery');
			await expectAgentShows(canvasElement, '"code":"fm-missing-delivery"');
			await waitFor(() => expect(clientText(canvasElement)).not.toContain('awaiting recorded turn'));
		});

		await step('reload after Solve: a late-joining preview shows the solved state, not the stale blocked one', async () => {
			const clientFrame = canvasElement.querySelectorAll('iframe')[0] as HTMLIFrameElement;
			clientFrame.contentWindow?.location.reload();
			await editorsReady(canvasElement);
			await expectClientShows(canvasElement, 'fm-missing-delivery');
		});

		await step('Reset: both panes return to the blocked starting state', async () => {
			tutorialStore.reset();
			await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)');
			await expect(agentText(canvasElement)).not.toContain('diagnostic');
		});
	},
};

// Mounts previews only after a delay, so AcpTraceBridge's first broadcast (on
// mount, before either iframe exists) necessarily reaches zero frames -- the
// opposite ordering from a reload, where the frame already existed and only
// its listener re-registered. This is the "slow WebContainer boot" case the
// reviewer named specifically: the very first `lesson-preview-ready` a
// preview ever sends must still land the *current* state, not whatever the
// bridge broadcast into an empty room before the preview existed.
function DelayedPreviews({ delayMs }: { delayMs: number }) {
	const [show, setShow] = useState(false);

	useEffect(() => {
		const id = window.setTimeout(() => setShow(true), delayMs);
		return () => window.clearTimeout(id);
	}, [delayMs]);

	if (!show) return null;

	return (
		<div className="previews-container">
			<AcpTracePreview />
		</div>
	);
}

export const DelayedBoot: Story = {
	render: () => (
		<>
			<AcpTraceBridge />
			<DelayedPreviews delayMs={1500} />
		</>
	),
	beforeEach: () => {
		seedTutorialStore({ data: lesson.data, files: lesson.files, solution: lesson.solved });
		return resetTutorialStore;
	},
	play: async ({ canvasElement }) => {
		// No iframes exist yet: AcpTraceBridge already mounted and broadcast once
		// into an empty room. Assert that, so the rest of this test is exercising
		// the ordering it claims to.
		expect(canvasElement.querySelectorAll('iframe').length).toBe(0);

		await editorsReady(canvasElement);
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)');
		await expectAgentShows(canvasElement, 'session/prompt');
	},
};

// -- Tier 3: lesson 2 -- continuity from lesson 1's solved state -----------

// Lesson 2's starter file already carries lesson 1's two solved frames
// verbatim (acpTraceContinuity.spec.ts proves this at the JSON level); this
// story is the same proof at the rendered level -- both panes show lesson
// 1's diagnostic on load, with no Solve press, before lesson 2's own new
// turn is revealed.
export const Lesson2StartsFromLesson1Solved: Story = {
	// Taller than the default 360px: Monaco's agent pane virtualizes
	// `.view-lines` to the visible viewport (wordWrap is on, and this
	// lesson's frames are long JSON lines), so a short pane would silently
	// drop the later frames from any textContent read -- confirmed live via
	// Playwright before picking this height.
	args: { payload: deriveAcpTraceState(lesson2, lesson2.files), height: 640 },
	play: async ({ canvasElement }) => {
		await editorsReady(canvasElement);
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  fm-missing-delivery');
		await expectClientShows(canvasElement, 'client: send prompt  ->  sent  session/prompt "Would the reorder-buffer model');
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)');
		await expectAgentShows(canvasElement, '"code":"fm-missing-delivery"');
	},
};

// Lesson 2 solved: the second turn's real PASS diagnostic (a different real
// witness, `reorder-buffer`, over the same subject) renders the same way --
// same marker/hover/CodeLens/evidence-widget code, an informational marker
// instead of an error one.
export const Lesson2Solved: Story = {
	// See Lesson2StartsFromLesson1Solved's comment: all 4 frames need to be
	// in the rendered viewport for a textContent read to see the last one.
	args: { payload: deriveAcpTraceState(lesson2, lesson2.solved), height: 640 },
	play: async ({ canvasElement }) => {
		await editorsReady(canvasElement);
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  fm-missing-delivery');
		await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  PASS');
		await expectAgentShows(canvasElement, '"code":"PASS"');

		const doc = canvasElement.querySelectorAll('iframe')[0]?.contentDocument;
		await waitFor(() => {
			if ((doc?.querySelectorAll('.codelens-decoration').length ?? 0) < 2) {
				throw new Error('expected a CodeLens for both diagnostics (lesson 1 and lesson 2 turns)');
			}
		});
	},
};
