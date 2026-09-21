import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import OtelWarmLogPreview from './OtelWarmLogPreview';
import RuleTraceBridge from '../components/RuleTraceBridge';
import LoanwordArcBridge from '../components/LoanwordArcBridge';
import { deriveLoanwordState, deriveRuleTraceState, loadLesson } from './lessonFixtures';
import {
	resetTutorialStore,
	seedTutorialStore,
	setDocuments,
} from '../../.storybook/tutorialkit-store';

// The reason-log lesson's fixture: no lesson-state message, just the page.
import reasonLog from '../content/tutorial/part-1/chapter-3/lesson-4/_files/reason-log.jsonl?raw';

const meta = {
	title: 'Lessons/OTel Warm Log (Monaco)',
	component: OtelWarmLogPreview,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof OtelWarmLogPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

// Each lesson is read from src/content: its frontmatter, starter `_files` and
// `_solution`. The only stubbed boundary below the bridge is the page's file
// fetch (`fixtures`), which is what the WebContainer's /__tk/file serves.
const traceLesson = loadLesson('part-1/chapter-2/lesson-1');
const loanwordLesson = loadLesson('part-1/chapter-1/lesson-1');

const editorReady = (canvasElement: HTMLElement) =>
	waitFor(
		() => {
			const frame = canvasElement.querySelector('iframe');
			if (!frame?.contentDocument?.querySelector('.monaco-editor .view-line')) {
				throw new Error('Monaco has not rendered yet');
			}
		},
		{ timeout: 15000 },
	);

// What the Monaco editor inside the page currently shows.
const pageText = (canvasElement: HTMLElement) =>
	(
		canvasElement.querySelector('iframe')?.contentDocument?.querySelector('.monaco-editor .view-lines')
			?.textContent ?? ''
	).replace(/ /g, ' ');

// The page's first region title is the lesson state: which title it renders
// depends on the payload it received, so this fails if the derivation drifts.
// Expected titles are written out on purpose -- they are the oracle.
const expectPageShows = (canvasElement: HTMLElement, title: string) =>
	waitFor(
		() => {
			const text = pageText(canvasElement);
			if (!text.includes(title)) throw new Error(`page does not show "${title}"; it shows: ${text.slice(0, 200)}`);
		},
		{ timeout: 15000 },
	);

const TRACE_BLOCKED = 'trace otel.opentrader.place_order blocked';
const TRACE_ANOMALY = 'trace otel.opentrader.place_order -> anomaly';
const LOANWORD_LOSS = 'trace lexeme.schadenfreude.translation -> loss';
const LOANWORD_PENDING = 'loanword(Schadenfreude) -> pending admission';
const LOANWORD_ADMITTED = 'loanword(Schadenfreude) -> admitted';

// -- Tier 1: payload derived by the lesson's protocol library ---------------

// Chapter 2, lesson 1: the trace stays blocked until the rule is solved...
export const TraceBlocked: Story = {
	args: {
		fixtures: traceLesson.files,
		payload: deriveRuleTraceState(traceLesson, traceLesson.files),
	},
	play: async ({ canvasElement }) => {
		await editorReady(canvasElement);
		await expectPageShows(canvasElement, TRACE_BLOCKED);
		await expect(pageText(canvasElement)).not.toContain('anomaly');
	},
};

// ...then replays the OpenTrader IDOR trace, anomaly span folded.
export const TraceSolved: Story = {
	args: {
		fixtures: traceLesson.solved,
		payload: deriveRuleTraceState(traceLesson, traceLesson.solved),
	},
	play: async ({ canvasElement }) => {
		await editorReady(canvasElement);
		await expectPageShows(canvasElement, TRACE_ANOMALY);
	},
};

const loanwordSource = 'tk-loanword-arc-bridge' as const;

// validateLoanwordLesson is async, so its result arrives through a loader.
const loanwordStory = (files: typeof loanwordLesson.files, title: string): Story => ({
	args: { fixtures: files, source: loanwordSource },
	loaders: [async () => ({ payload: await deriveLoanwordState(loanwordLesson, files) })],
	render: (args, { loaded }) => <OtelWarmLogPreview {...args} payload={loaded.payload} />,
	play: async ({ canvasElement }) => {
		await editorReady(canvasElement);
		await expectPageShows(canvasElement, title);
	},
});

// Chapter 1, lesson 1: a static warm log that walks the loanword states.
export const LoanwordParaphraseLoss = loanwordStory(loanwordLesson.files, LOANWORD_LOSS);

export const LoanwordCompleted = loanwordStory(loanwordLesson.solved, LOANWORD_ADMITTED);

// -- Tier 2: the real bridge component drives the page ----------------------

// The bridges find the preview by its TutorialKit container class and post
// `lesson-state` to it themselves, so no payload is passed to the preview.
const withBridge = (bridge: React.ReactNode): Story['render'] => (args) => (
	<>
		{bridge}
		<div className="previews-container">
			<OtelWarmLogPreview {...args} />
		</div>
	</>
);

const seedFrom = (lesson: typeof traceLesson) => () => {
	seedTutorialStore({ data: lesson.data, files: lesson.files, focus: lesson.focus });
	return resetTutorialStore;
};

// RuleTraceBridge reads /exercise.de and /authorization-grammar.json from the
// store, builds the state with ruleTraceProtocol, and posts it. Solve writes
// the lesson's `_solution` into the store, as TutorialKit does.
export const TraceViaBridge: Story = {
	args: { fixtures: traceLesson.solved },
	render: withBridge(<RuleTraceBridge />),
	beforeEach: seedFrom(traceLesson),
	play: async ({ canvasElement, step }) => {
		await step('starter file: trace blocked', async () => {
			await editorReady(canvasElement);
			await expectPageShows(canvasElement, TRACE_BLOCKED);
		});
		await step('Solve: trace opens on the anomaly', async () => {
			setDocuments({ '/exercise.de': traceLesson.solved['/exercise.de'] });
			await expectPageShows(canvasElement, TRACE_ANOMALY);
		});
	},
};

// LoanwordArcBridge validates through loanwordArcProtocol against two files
// (translation.en, then PersonalVocabulary.pkl): the lesson's two gates.
export const LoanwordViaBridge: Story = {
	args: { fixtures: loanwordLesson.solved, source: loanwordSource },
	render: withBridge(<LoanwordArcBridge />),
	beforeEach: seedFrom(loanwordLesson),
	play: async ({ canvasElement, step }) => {
		const feedback = within(canvasElement).getByRole('status');
		await step('paraphrase: source form required', async () => {
			await editorReady(canvasElement);
			await waitFor(() => expect(feedback).toHaveTextContent('requires the source form'));
			await expectPageShows(canvasElement, LOANWORD_LOSS);
		});
		await step('source form preserved: vocabulary gate still blocks', async () => {
			setDocuments({ '/translation.en': loanwordLesson.solved['/translation.en'] });
			await waitFor(() => expect(feedback).toHaveTextContent('pass the second check'));
			await expectPageShows(canvasElement, LOANWORD_PENDING);
		});
		await step('vocabulary admits the word: accepted', async () => {
			setDocuments({ '/PersonalVocabulary.pkl': loanwordLesson.solved['/PersonalVocabulary.pkl'] });
			await waitFor(() => expect(feedback).toHaveTextContent('Accepted by this lesson'));
			await expectPageShows(canvasElement, LOANWORD_ADMITTED);
		});
	},
};

// Chapter 3, lesson 4: no lesson-state message at all. The page loads
// /reason-log.jsonl and underlines failing lines; hover for the verdict and
// its evidence, or click a line's CodeLens for the evidence panel. The
// fourth line is CIT-176's pre-merge disagreement (synthetic fixture).
export const ReasonLogDiagnostics: Story = {
	args: { fixtures: { '/reason-log.jsonl': reasonLog }, height: 480 },
	play: async ({ canvasElement }) => {
		await editorReady(canvasElement);
		await waitFor(
			() => {
				const doc = canvasElement.querySelector('iframe')?.contentDocument;
				// One CodeLens verdict row per failing record (lines 2, 3 and 4).
				if (doc?.querySelectorAll('.codelens-decoration').length !== 3) {
					throw new Error('reason-log CodeLens verdicts have not rendered yet');
				}
			},
			{ timeout: 15000 },
		);
	},
};

// CIT-176: activate the pre-merge lens on line 4. The evidence widget lists
// each candidate's contribution, the combined path, the rule and the check,
// every location qualified by its revision (path@sim-revision:line).
export const PreMergeDisagreementEvidence: Story = {
	args: { ...ReasonLogDiagnostics.args, height: 560 },
	play: async ({ canvasElement }) => {
		await ReasonLogDiagnostics.play!({ canvasElement } as never);
		const doc = canvasElement.querySelector('iframe')!.contentDocument!;
		const lens = Array.from(doc.querySelectorAll<HTMLElement>('.codelens-decoration a')).find((a) =>
			a.textContent?.includes('POLICY_CLASS_REACHES_EXTERNAL'),
		);
		if (!lens) throw new Error('pre-merge CodeLens not found');
		// Monaco listens for the full pointer sequence, not a bare click().
		const win = doc.defaultView!;
		for (const type of ['mousedown', 'mouseup', 'click']) {
			lens.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
		}
		await waitFor(() => {
			const text = doc.querySelector('.evidence-widget')?.textContent ?? '';
			for (const needle of ['candidate A', 'candidate B', 'flow-policy@1', 'agent.tasks@sim-']) {
				if (!text.includes(needle)) throw new Error('evidence widget missing ' + needle);
			}
		});
	},
};
