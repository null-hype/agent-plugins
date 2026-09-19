import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { waitFor } from 'storybook/test';
import OtelWarmLogPreview from './OtelWarmLogPreview';

// The lessons' own fixtures, so each story shows what that lesson renders.
import traceStory from '../content/tutorial/part-1/chapter-2/lesson-1/_files/trace-story.json?raw';
import warmLogStory from '../content/tutorial/part-1/chapter-1/lesson-1/_files/warm-log-story.json?raw';
import reasonLog from '../content/tutorial/part-1/chapter-3/lesson-4/_files/reason-log.jsonl?raw';

const meta = {
	title: 'Lessons/OTel Warm Log (Monaco)',
	component: OtelWarmLogPreview,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof OtelWarmLogPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

const traceFixtures = { '/trace-story.json': traceStory };
const warmLogFixtures = { '/warm-log-story.json': warmLogStory };

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

// Chapter 2, lesson 1: the trace stays blocked until the rule is solved...
export const TraceBlocked: Story = {
	args: {
		fixtures: traceFixtures,
		payload: {
			previewMode: 'blocked-until-valid',
			scenario: 'opentrader-idor',
			solved: false,
			storyFile: '/trace-story.json',
		},
	},
	play: ({ canvasElement }) => editorReady(canvasElement),
};

// ...then replays the OpenTrader IDOR trace, anomaly span folded.
export const TraceSolved: Story = {
	args: {
		...TraceBlocked.args,
		payload: { ...TraceBlocked.args!.payload, solved: true },
	},
	play: ({ canvasElement }) => editorReady(canvasElement),
};

// Chapter 1, lesson 1: a static warm log that walks the loanword states.
export const LoanwordParaphraseLoss: Story = {
	args: {
		fixtures: warmLogFixtures,
		source: 'tk-loanword-arc-bridge',
		payload: {
			previewMode: 'static-log-with-completion',
			previewState: 'paraphrase-loss',
			scenario: 'schadenfreude-admission',
			solved: false,
			storyFile: '/warm-log-story.json',
		},
	},
	play: ({ canvasElement }) => editorReady(canvasElement),
};

export const LoanwordCompleted: Story = {
	args: {
		...LoanwordParaphraseLoss.args,
		payload: {
			...LoanwordParaphraseLoss.args!.payload,
			previewState: 'completed',
			solved: true,
		},
	},
	play: ({ canvasElement }) => editorReady(canvasElement),
};

// Chapter 3, lesson 4: no lesson-state message at all. The page loads
// /reason-log.jsonl and underlines failing lines; hover for the verdict and
// its evidence, or click a line's CodeLens for the evidence panel.
export const ReasonLogDiagnostics: Story = {
	args: { fixtures: { '/reason-log.jsonl': reasonLog }, height: 480 },
	play: async ({ canvasElement }) => {
		await editorReady(canvasElement);
		await waitFor(
			() => {
				const doc = canvasElement.querySelector('iframe')?.contentDocument;
				// One CodeLens verdict row per failing record (lines 2 and 3).
				if (doc?.querySelectorAll('.codelens-decoration').length !== 2) {
					throw new Error('reason-log CodeLens verdicts have not rendered yet');
				}
			},
			{ timeout: 15000 },
		);
	},
};
