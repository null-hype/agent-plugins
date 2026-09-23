import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import AcpTracePreview from './AcpTracePreview';
import AcpTraceBridge from '../components/AcpTraceBridge';
import { loadLesson } from './lessonFixtures';
import tutorialStore, { resetTutorialStore, seedTutorialStore } from '../../.storybook/tutorialkit-store';

const meta = {
	title: 'Lessons/Smuggling Survives the Merge',
	component: AcpTracePreview,
	// docs.story.autoplay: false -- these play() functions replay a lesson's
	// turns on a delay-free but still stateful sequence (solve()/reset()
	// against the real store); the default is to fire that the instant a
	// reader scrolls a story into view on the autodocs page, which is wrong
	// for a step()-narrated replay meant to be read, not merely rendered.
	// The Canvas view (a story opened on its own) is unaffected -- Storybook
	// always autoplays there, since play() is also how the story sets up its
	// own state, not only how it's interaction-tested.
	parameters: { layout: 'padded', docs: { story: { autoplay: false } } },
} satisfies Meta<typeof AcpTracePreview>;

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

const expectClientShows = (canvasElement: HTMLElement, needle: string) =>
	waitFor(
		() => {
			const text = clientText(canvasElement);
			if (!text.includes(needle)) throw new Error(`client pane does not show "${needle}"; it shows: ${text.slice(0, 300)}`);
		},
		{ timeout: 15000 },
	);

const expectAgentShows = (canvasElement: HTMLElement, needle: string) =>
	waitFor(
		() => {
			const text = agentText(canvasElement);
			if (!text.includes(needle)) throw new Error(`agent pane does not show "${needle}"; it shows: ${text.slice(0, 300)}`);
		},
		{ timeout: 15000 },
	);

// ViaBridge tier (see AcpTrace.stories.tsx's ViaBridge): the real
// AcpTraceBridge + AcpTracePreview, driven through the tutorial store's own
// solve()/reset(), one step() per beat of the lesson's own prose -- so this
// play function *is* the lesson, replayed, and Storybook's autodocs for it
// reads like a walkthrough rather than a props table.
export const TwoPatchesReviewedIndependently: Story = {
	// height: 640 -- default 360 is too short once the Agent pane's raw JSON
	// dump is a single long word-wrapped line (this lesson's pin text is
	// long); see AcpTrace.stories.tsx's Lesson2StartsFromLesson1Solved for
	// the same fix and the fuller explanation of why a short pane silently
	// truncates any textContent read to whatever's actually in the viewport.
	render: () => (
		<>
			<AcpTraceBridge />
			<div className="previews-container">
				<AcpTracePreview height={640} />
			</div>
		</>
	),
	beforeEach: () => {
		seedTutorialStore({ data: lesson1.data, files: lesson1.files, solution: lesson1.solved });
		return resetTutorialStore;
	},
	play: async ({ canvasElement, step }) => {
		await step('Two branches land: relay-header-normalize, gunicorn-image-bump -- neither reviewed yet', async () => {
			await editorsReady(canvasElement);
			await expectClientShows(canvasElement, 'waiting for trace: no commits picked yet');
			await expectAgentShows(canvasElement, 'no frames received yet');
		});

		await step('Solve: each diff reviewed independently, on its own file -- approved, approved', async () => {
			tutorialStore.solve();
			await expectClientShows(canvasElement, 'pick c866856ba8d7 relay: normalize whitespace in Transfer-Encoding list values');
			await expectClientShows(canvasElement, 'pick 8b4710aba698 gunicorn: bump base image (security patch)');
			await expectAgentShows(canvasElement, 'Patch: relay-header-normalize');
			await expectAgentShows(canvasElement, 'Patch: gunicorn-image-bump');
			await expectAgentShows(canvasElement, 'approved');
		});
	},
};

export const GitButlerAppliesBoth: Story = {
	render: () => (
		<>
			<AcpTraceBridge />
			<div className="previews-container">
				<AcpTracePreview height={640} />
			</div>
		</>
	),
	beforeEach: () => {
		seedTutorialStore({ data: lesson2.data, files: lesson2.files, solution: lesson2.solved });
		return resetTutorialStore;
	},
	play: async ({ canvasElement, step }) => {
		await step('Starts from lesson 1: both patches already approved, independently', async () => {
			await editorsReady(canvasElement);
			await expectClientShows(canvasElement, 'pick c866856ba8d7 relay: normalize whitespace in Transfer-Encoding list values');
			await expectClientShows(canvasElement, 'pick 8b4710aba698 gunicorn: bump base image (security patch)');
			await expectAgentShows(canvasElement, 'approved');
		});

		await step('Solve: GitButler applies both virtual branches -- clean, 0 conflicts', async () => {
			tutorialStore.solve();
			await expectClientShows(canvasElement, 'pick 480731005c26 relay+gunicorn: normalize TE whitespace, bump image');
			await expectClientShows(canvasElement, 'clean apply · 0 conflicts · defenses.md auto-merged');
			await expectAgentShows(canvasElement, 'clean · 0 conflicts · defenses.md auto-merged');

			// The merge squashes the buffer -- it doesn't append to it. Two
			// picks become one; the two branch names shouldn't still be
			// sitting there as their own lines once GitButler's applied both.
			const text = clientText(canvasElement);
			expect(text).not.toContain('pick c866856ba8d7');
			expect(text).not.toContain('pick 8b4710aba698');
		});
	},
};

// This lesson's whole point is what the play function below asserts
// directly: dagger call bootstrap is the only one of the three checks
// (independent review, GitButler's merge, this one) that can see the
// smuggling defense reopen -- and the rebase-todo buffer a reviewer would
// actually be staring at never moves to tell them so.
export const BootstrapFindsItReopened: Story = {
	render: () => (
		<>
			<AcpTraceBridge />
			<div className="previews-container">
				<AcpTracePreview height={640} />
			</div>
		</>
	),
	beforeEach: () => {
		seedTutorialStore({ data: lesson3.data, files: lesson3.files, solution: lesson3.solved });
		return resetTutorialStore;
	},
	play: async ({ canvasElement, step }) => {
		let bufferBeforeBootstrap = '';

		await step('Starts from lesson 2: the merged tree, clean, 0 conflicts', async () => {
			await editorsReady(canvasElement);
			await expectClientShows(canvasElement, 'pick 480731005c26 relay+gunicorn: normalize TE whitespace, bump image');
			bufferBeforeBootstrap = clientText(canvasElement);
		});

		await step('Solve: dagger call bootstrap replays the real baseline against the merged tree -- FAIL', async () => {
			tutorialStore.solve();
			await expectAgentShows(canvasElement, 'gunicorn bounty_0: direct GET /admin -> 403');
			await expectAgentShows(canvasElement, "relay's normalizer now treats 'chunked, gzip' (with a space)");
			await expectAgentShows(canvasElement, 'FAIL');

			// The point of this whole chapter: the rebase-todo buffer a
			// reviewer would be staring at in vim is byte-for-byte identical
			// to what it was before Solve. Neither the independent reviews
			// nor GitButler's clean apply could have shown this regression;
			// this pane still can't, even now -- only the Agent pane, which
			// is where the actual bootstrap result lands, changed at all.
			expect(clientText(canvasElement)).toBe(bufferBeforeBootstrap);
		});
	},
};
