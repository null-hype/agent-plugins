import React, { useMemo, useReducer } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import OtelWarmLogPreview from './OtelWarmLogPreview';
import FollowerMazeStatus from '../lesson-farms/follower-maze/FollowerMazeStatus';
import {
	boardFor,
	initialLessonState,
	reduceLesson,
	toJsonl,
	type LessonAction,
} from '../lesson-farms/follower-maze/followerMazeLog';
import type { WitnessModelId } from '../lesson-farms/follower-maze/followerMaze';
import arrivalOrderLog from '../lesson-farms/follower-maze/fixtures/permutations.arrival-order.jsonl?raw';
import reorderBufferLog from '../lesson-farms/follower-maze/fixtures/permutations.reorder-buffer.jsonl?raw';

/**
 * CIT-203: the Follower Maze lesson, rendered by the warm log.
 *
 * Every diagnostic here -- squiggle, hover, CodeLens, evidence widget -- is
 * drawn by templates/otel-warm-log's own Monaco marker path. This file adds no
 * diagnostic-rendering surface: the lesson hands the page `{raw, diagnostic,
 * related}` records (followerMazeLog.ts) and a status strip shows the axiom
 * badge and counter footer, which are board *state* derived from those same
 * records.
 *
 * Frames 1-4 are two-to-five-line states, and they are rendered by the warm
 * log too rather than as cards. Reason: the lesson's wire format
 * (`1|F|10|20`) is already a newline-delimited stream, the "green here rules out
 * nothing" band is a Warning marker on the baseline verdict line, and one
 * surface for all six frames means frame 4 -> 5 is the same document gaining
 * markers, not a swap of components. What has no native slot is a persistent
 * badge and counter, which is why the status strip exists.
 *
 * The storyboard's six frames are play() steps that drive the lesson with the
 * three things a learner does (solve, evaluate, transform). No component takes
 * a frame prop; a step that could not be reached by driving state would be a
 * finding about the design.
 */
const meta = {
	title: 'Lessons/Follower Maze (ordered routing)',
	component: OtelWarmLogPreview,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof OtelWarmLogPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

// -- the lesson, as a learner drives it ---------------------------------------

function Workbench({ model, height }: { model: WitnessModelId; height: number }) {
	const [state, dispatch] = useReducer(reduceLesson, initialLessonState);
	const board = useMemo(() => boardFor(state), [state]);
	const fixtures = useMemo(() => ({ '/reason-log.jsonl': toJsonl(board.records) }), [board]);
	const act = (action: LessonAction) => () => dispatch(action);
	return (
		<>
			<div role="toolbar" aria-label="lesson actions" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
				<button onClick={act({ type: 'solve', model })}>Run solve()</button>
				<button onClick={act({ type: 'evaluate' })}>Evaluate</button>
				<button onClick={act({ type: 'transform' })}>Transform arrival order</button>
			</div>
			<FollowerMazeStatus board={board} />
			<OtelWarmLogPreview fixtures={fixtures} height={height} />
		</>
	);
}

// -- helpers over the real Monaco page inside the preview frame ----------------

const frameDoc = (canvasElement: HTMLElement) => canvasElement.querySelector('iframe')!.contentDocument!;

type Monaco = {
	MarkerSeverity: { Error: number; Warning: number };
	editor: { getModelMarkers(filter: object): { severity: number; code?: string | { value: string }; message: string }[] };
};
// The page swaps documents whenever the lesson hands it a new log, so Monaco may
// not exist yet: throw until it does and let waitFor retry.
const markers = (canvasElement: HTMLElement) => {
	const monaco = (canvasElement.querySelector('iframe')?.contentWindow as unknown as { monaco?: Monaco } | null)?.monaco;
	if (!monaco) throw new Error('Monaco is not loaded in the preview frame yet');
	return monaco.editor.getModelMarkers({});
};

const expectMarkers = (canvasElement: HTMLElement, count: number) =>
	waitFor(() => expect(markers(canvasElement)).toHaveLength(count), { timeout: 15000 });

const lensCount = (canvasElement: HTMLElement) => frameDoc(canvasElement).querySelectorAll('.codelens-decoration').length;

// The text of the editor's rendered lines (Monaco swaps spaces for nbsp).
const editorLines = (canvasElement: HTMLElement) =>
	Array.from(frameDoc(canvasElement).querySelectorAll('.monaco-editor .view-lines .view-line')).map((line) =>
		(line.textContent ?? '').replace(/ /g, ' '),
	);

// The page rebuilds the editor whenever the lesson hands it a new log, so every
// step waits for a line that only that step's document contains.
const pageShows = (canvasElement: HTMLElement, text: string) =>
	waitFor(
		() => {
			if (!editorLines(canvasElement).some((line) => line.includes(text))) {
				throw new Error(`editor does not show "${text}"; it shows: ${editorLines(canvasElement).join(' / ').slice(0, 300)}`);
			}
		},
		{ timeout: 15000 },
	);

const lensesRendered = (canvasElement: HTMLElement, expected: number) =>
	waitFor(
		() => {
			if (lensCount(canvasElement) !== expected) {
				throw new Error(`expected ${expected} CodeLens rows, found ${lensCount(canvasElement)}`);
			}
		},
		{ timeout: 15000 },
	);

// Monaco listens for the full pointer sequence, not a bare click().
function activate(doc: Document, element: HTMLElement) {
	const win = doc.defaultView!;
	for (const type of ['mousedown', 'mouseup', 'click']) {
		element.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
	}
}

// The CodeLens sits in a view zone directly above its line: pick the nearest
// lens whose bottom edge is at or above that line's top.
function lensAbove(doc: Document, lineText: string): HTMLElement {
	const line = Array.from(doc.querySelectorAll<HTMLElement>('.monaco-editor .view-lines .view-line')).find((el) =>
		(el.textContent ?? '').replace(/ /g, ' ').startsWith(lineText),
	);
	if (!line) throw new Error(`no editor line starts with ${lineText}`);
	const top = line.getBoundingClientRect().top;
	const above = Array.from(doc.querySelectorAll<HTMLElement>('.codelens-decoration'))
		.map((lens) => ({ lens, bottom: lens.getBoundingClientRect().bottom }))
		.filter(({ bottom }) => bottom <= top + 2)
		.sort((a, b) => b.bottom - a.bottom)[0];
	if (!above) throw new Error(`no CodeLens above ${lineText}`);
	return above.lens.querySelector<HTMLElement>('a') ?? above.lens;
}

const TALL = 1100; // 24 lines plus a CodeLens row above each failing one

// -- the six storyboard frames, as one walkthrough -----------------------------

export const Walkthrough: Story = {
	render: () => <Workbench model="arrival-order" height={TALL} />,
	play: async ({ canvasElement, step }) => {
		const canvas = within(canvasElement);
		const badge = () => canvas.getByTestId('axiom-badge');
		const footer = () => canvas.getByTestId('counter-footer');

		await step('1 · render: world and required pane filled, witness pane empty', async () => {
			await pageShows(canvasElement, 'witness awaiting solve()');
			await pageShows(canvasElement, 'required 10 <- seq 2');
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 1 world');
			await expectMarkers(canvasElement, 0);
		});

		await step("2 · witness: the learner's solve() output appears, unevaluated", async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Run solve()' }));
			await pageShows(canvasElement, 'witness 10 <- seq 2');
			await expect(editorLines(canvasElement).join('\n')).not.toContain('awaiting solve()');
			await expectMarkers(canvasElement, 0);
		});

		await step('3 · evaluate baseline: green, with a warning that green rules out nothing', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			await pageShows(canvasElement, 'PASS');
			await expectMarkers(canvasElement, 1);
			const [marker] = markers(canvasElement);
			await expect(marker.severity).toBe(4); // MarkerSeverity.Warning: not an error, the baseline did pass
			await expect(marker.message).toContain('green here rules out nothing');
			await expect(marker.message).toContain('4 of 24');
			await lensesRendered(canvasElement, 1);
			await expect(footer()).toHaveTextContent('1 pass · 0 missing · 0 forbidden · 0 both');
		});

		await step('4 · transform: the same four events in 24 arrival orders, axiom unchanged', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Transform arrival order' }));
			await pageShows(canvasElement, '[4,2,3,1]');
			await waitFor(() => expect(editorLines(canvasElement)).toHaveLength(24));
			await expectMarkers(canvasElement, 0);
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 24 worlds');
			await expect(footer()).toHaveTextContent('not evaluated');
		});

		await step('5 · evaluate family: 20 of 24 orderings fail, by the description table', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			await lensesRendered(canvasElement, 20);
			const found = markers(canvasElement);
			await expectMarkers(canvasElement, 20);
			await expect(found.every((marker) => marker.severity === 8)).toBe(true); // MarkerSeverity.Error
			const codes = found.map((marker) => (typeof marker.code === 'string' ? marker.code : marker.code?.value));
			await expect(codes.filter((code) => code === 'fm-missing-delivery')).toHaveLength(16); // 12 missing + 4 both
			await expect(codes.filter((code) => code === 'fm-forbidden-delivery')).toHaveLength(4);
			await expect(footer()).toHaveTextContent('4 pass · 12 missing · 4 forbidden · 4 both');
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 24 worlds');
		});

		await step('6 · open a failing world: [4,2,3,1] shows the diagnostic, its evidence and the repairs', async () => {
			const doc = frameDoc(canvasElement);
			activate(doc, lensAbove(doc, '[4,2,3,1]'));
			await waitFor(() => {
				const text = doc.querySelector('.evidence-widget')?.textContent ?? '';
				for (const needle of [
					'fm-missing-delivery(seq=2,user=10)',
					'ordering errors surface as routing errors because follow-state is temporal',
					'change world',
					'change model',
					'change axiom',
				]) {
					if (!text.includes(needle)) throw new Error(`evidence widget missing "${needle}"`);
				}
			});
		});
	},
};

// -- the family as a standalone document, for each witness model ----------------

// Frames 5 and 6 without the walkthrough: the committed permutations.jsonl fixture
// (regenerable -- followerMaze.spec.ts fails if it drifts from the code).
export const ArrivalOrderFamily: Story = {
	args: { fixtures: { '/reason-log.jsonl': arrivalOrderLog }, height: TALL },
	play: async ({ canvasElement }) => {
		await lensesRendered(canvasElement, 20);
		await expectMarkers(canvasElement, 20);
	},
};

// A sequence-aware witness passes all 24 orderings: 24 lines, no marker, no lens.
export const SequenceAwareFamily: Story = {
	args: { fixtures: { '/reason-log.jsonl': reorderBufferLog }, height: TALL },
	play: async ({ canvasElement }) => {
		await pageShows(canvasElement, '[4,2,3,1]');
		await waitFor(() => expect(editorLines(canvasElement)).toHaveLength(24));
		await expectMarkers(canvasElement, 0);
		await expect(lensCount(canvasElement)).toBe(0);
	},
};

// The same walkthrough with the sequence-aware witness: the baseline warning
// disappears because this model is not fooled by it.
export const SequenceAwareWalkthrough: Story = {
	render: () => <Workbench model="reorder-buffer" height={TALL} />,
	play: async ({ canvasElement, step }) => {
		const canvas = within(canvasElement);
		await step('solve, evaluate baseline: green and no warning', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Run solve()' }));
			await pageShows(canvasElement, 'witness 10 <- seq 2');
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			await pageShows(canvasElement, 'PASS');
			await expectMarkers(canvasElement, 0);
		});
		await step('transform, evaluate family: 24 of 24', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Transform arrival order' }));
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			await waitFor(() => expect(canvas.getByTestId('counter-footer')).toHaveTextContent('24 pass · 0 missing · 0 forbidden · 0 both'));
			await expectMarkers(canvasElement, 0);
		});
	},
};
