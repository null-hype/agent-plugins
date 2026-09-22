import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import AcpTracePreview from './AcpTracePreview';
import AcpTraceBridge from '../components/AcpTraceBridge';
import { deriveAcpTraceState, loadLesson } from './lessonFixtures';
import { resetTutorialStore, seedTutorialStore } from '../../.storybook/tutorialkit-store';

const meta = {
	title: 'Lessons/ACP Trace (Ghost Trace Machine)',
	component: AcpTracePreview,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof AcpTracePreview>;

export default meta;

type Story = StoryObj<typeof meta>;

const lesson = loadLesson('part-2/chapter-1/lesson-1');

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
		await expectClientShows(canvasElement, 'client: send prompt -> sent');
		await expectClientShows(canvasElement, 'agent: reply with diagnostic -- blocked');
		await expect(clientText(canvasElement)).not.toContain('LEDGER_WRITE_CONFLICT');
		await expectAgentShows(canvasElement, 'session/prompt');
		await expect(agentText(canvasElement)).not.toContain('diagnostic');
	},
};

// The solution file: the agent's diagnostic reply revealed, in both panes.
export const Solved: Story = {
	args: { payload: deriveAcpTraceState(lesson, lesson.solved) },
	play: async ({ canvasElement }) => {
		await editorsReady(canvasElement);
		await expectClientShows(canvasElement, 'agent: reply with diagnostic -> ok');
		await expectClientShows(canvasElement, 'diagnostic: [error] LEDGER_WRITE_CONFLICT');
		await expectAgentShows(canvasElement, '"code":"LEDGER_WRITE_CONFLICT"');
	},
};

// -- Tier 2: the real bridge drives both pages, Solve is a real click -------

// AcpTraceBridge reads /acp-trace.json from the store, builds the state with
// acpTraceProtocol, and broadcasts it to both preview iframes. Solve calls
// the store's own solve() (the `_files` -> `_solution` swap); this story
// clicks the actual rendered button, not a simulated state change.
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
			await expectClientShows(canvasElement, 'agent: reply with diagnostic -- blocked');
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

		const solveButton = await within(canvasElement).findByRole('button', {
			name: 'Solve: Agent: reply with diagnostic',
		});

		await step('Solve: both panes reveal the same recorded diagnostic', async () => {
			solveButton.click();
			await expectClientShows(canvasElement, 'diagnostic: [error] LEDGER_WRITE_CONFLICT');
			await expectAgentShows(canvasElement, '"code":"LEDGER_WRITE_CONFLICT"');
			await within(canvasElement).findByText('Trace complete.');
		});

		await step('reload after Solve: a late-joining preview shows the solved state, not the stale blocked one', async () => {
			const clientFrame = canvasElement.querySelectorAll('iframe')[0] as HTMLIFrameElement;
			clientFrame.contentWindow?.location.reload();
			await editorsReady(canvasElement);
			await expectClientShows(canvasElement, 'diagnostic: [error] LEDGER_WRITE_CONFLICT');
		});

		await step('Reset: both panes return to the blocked starting state', async () => {
			const resetButton = within(canvasElement).getByRole('button', { name: 'Reset' });
			resetButton.click();
			await expectClientShows(canvasElement, 'agent: reply with diagnostic -- blocked');
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
		await expectClientShows(canvasElement, 'agent: reply with diagnostic -- blocked');
		await expectAgentShows(canvasElement, 'session/prompt');
	},
};
