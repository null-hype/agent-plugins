import React, { useMemo, useReducer, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import OtelWarmLogPreview from './OtelWarmLogPreview';
import FollowerMazeStatus from '../lesson-farms/follower-maze/FollowerMazeStatus';
import { Channels } from '../lesson-farms/follower-maze/FollowerMazeChannels';
import { RepairRow } from '../lesson-farms/follower-maze/FollowerMazeBoardState';
import {
	boardFor,
	initialLessonState,
	reduceLesson,
	toJsonl,
	type LessonAction,
} from '../lesson-farms/follower-maze/followerMazeLog';
import { WITNESS_MODELS, type WitnessModelId } from '../lesson-farms/follower-maze/followerMaze';
import { BARE_REASONS, TIGHT_REASONS } from '../lesson-farms/follower-maze/followerMazeReasons';
import arrivalOrderLog from '../lesson-farms/follower-maze/fixtures/permutations.arrival-order.jsonl?raw';
import reorderBufferLog from '../lesson-farms/follower-maze/fixtures/permutations.reorder-buffer.jsonl?raw';

/**
 * CIT-203: the Follower Maze lesson, rendered by the warm log.
 *
 * Every diagnostic here -- squiggle, hover, CodeLens, evidence widget -- is
 * drawn by templates/otel-warm-log's own Monaco marker path. This file adds no
 * diagnostic-rendering surface: the lesson hands the page `{raw, diagnostic,
 * related}` records (followerMazeLog.ts). Three small pieces show board *state*
 * derived from those same records and never a diagnostic: the axiom badge and
 * counter footer (FollowerMazeStatus), the 6x4 outcome grid, and the repair row
 * (FollowerMazeBoardState -- CIT-226). The expected-vs-actual pairing lives in the
 * evidence widget's own rows.
 *
 * CIT-227: the interaction is NOT a warm-log document. Input (events sent) and
 * monitor (what the implementation emitted) are their own channels, as in the
 * CIT-199 pre-cog board; the warm log is the diagnostic channel only, reconciling
 * the monitor against the protocol. Each of the 24 orderings is an alternate
 * execution of the same thread; the grid chips select which one the channels show.
 *
 * (Earlier text, superseded for frames 1-2:) Frames 1-4 were rendered by the warm
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

// `model` is the witness model the learner starts with; the selector changes it.
function Workbench({ model, height }: { model: WitnessModelId; height: number }) {
	const [state, dispatch] = useReducer(reduceLesson, initialLessonState);
	const [choice, setChoice] = useState<WitnessModelId>(model);
	const board = useMemo(() => boardFor(state), [state]);
	const act = (action: LessonAction) => () => dispatch(action);
	// The repair the lesson can actually offer: swap the model, then rerun the
	// same family in place (solve keeps the arrival orderings; evaluate reruns them).
	const switchModel = (next: WitnessModelId) => {
		setChoice(next);
		dispatch({ type: 'solve', model: next });
		dispatch({ type: 'evaluate' });
	};
	return (
		<>
			<div role="toolbar" aria-label="lesson actions" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
				<label>
					Witness model{' '}
					<select value={choice} onChange={(event) => setChoice(event.target.value as WitnessModelId)}>
						{Object.keys(WITNESS_MODELS).map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</select>
				</label>
				<button onClick={act({ type: 'solve', model: choice })}>Send events to the implementation</button>
				<button onClick={act({ type: 'evaluate' })}>Evaluate</button>
				<button onClick={act({ type: 'transform' })}>Transform arrival order</button>
			</div>
			<FollowerMazeStatus board={board} />
			<Channels board={board} onSelect={(name) => dispatch({ type: 'select', name })}>
				<OtelWarmLogPreview records={board.records} editable={board.editable} onEdit={(text) => dispatch({ type: 'write', text })} height={height} />
			</Channels>
			<RepairRow board={board} witness={state.witness} onSwitchModel={switchModel} />
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

// What the CodeLens rows say on screen, i.e. what a learner reads without hovering.
const lensTexts = (canvasElement: HTMLElement) =>
	Array.from(frameDoc(canvasElement).querySelectorAll('.codelens-decoration')).map((lens) => lens.textContent ?? '');

const lensCount = (canvasElement: HTMLElement) => frameDoc(canvasElement).querySelectorAll('.codelens-decoration').length;

// The document's lines, from the editor's model: the rendered lines wrap at a half-width
// pane, and a wrapped row is not a line of the log.
const editorLines = (canvasElement: HTMLElement) => {
	const monaco = (canvasElement.querySelector('iframe')?.contentWindow as unknown as {
		monaco?: { editor: { getModels(): { getValue(): string }[] } };
	} | null)?.monaco;
	const model = monaco?.editor.getModels()[0];
	if (!model) throw new Error('the editor has no model yet');
	return model.getValue().split('\n');
};

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

// The learner's typing, as the editor sees it: replace the model's text, which fires the
// same content-change event a keystroke does (the page cannot tell them apart).
const typeReasons = (canvasElement: HTMLElement, text: string) => {
	const monaco = (canvasElement.querySelector('iframe')?.contentWindow as unknown as {
		monaco?: { editor: { getModels(): { setValue(text: string): void }[] } };
	} | null)?.monaco;
	const model = monaco?.editor.getModels()[0];
	if (!model) throw new Error('the editor has no model yet');
	model.setValue(text);
};

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

		const monitor = () => canvas.getByTestId('monitor-channel');

		await step('0 · write: the learner types the reasons; bare reasons permit all 24 orders, effects prune to 4', async () => {
			// An empty, editable input: the learner plays the agent and makes the claims.
			await expect(monitor()).toHaveTextContent('awaiting reasons');
			await expect(canvas.getByTestId('legal-worlds')).toHaveTextContent('write the reasons first');
			await waitFor(() => expect(canvas.getByRole('button', { name: 'Send events to the implementation' })).toBeEnabled());
			await waitFor(() => typeReasons(canvasElement, BARE_REASONS), { timeout: 15000 });
			await pageShows(canvasElement, 'PROTON_PASS_AGENT_REASON=status|20');
			// Static channel: each bare status declares no effect (a linter over the typed input).
			await expectMarkers(canvasElement, 2);
			await expect(markers(canvasElement).every((marker) => marker.severity === 4)).toBe(true);
			await expect(canvas.getByTestId('legal-worlds')).toHaveTextContent('24 of 24 arrival orders legal');
			typeReasons(canvasElement, TIGHT_REASONS);
			await pageShows(canvasElement, 'status|20 -> [10]');
			await expectMarkers(canvasElement, 0);
			await expect(canvas.getByTestId('legal-worlds')).toHaveTextContent('4 of 24 arrival orders legal');
		});

		await step('1 · render: the reasons entered in the input channel, monitor empty, diagnostic silent', async () => {
			// The input is the editor itself: the four reasons as typed, one per line.
			await pageShows(canvasElement, 'PROTON_PASS_AGENT_REASON=follow|10|20');
			await pageShows(canvasElement, 'status|20 -> []');
			await expect(monitor()).toHaveTextContent('awaiting send');
			// What the implementation emitted is the monitor's, never a line of the editor.
			await expect(editorLines(canvasElement).join('\n')).not.toContain('<- seq');
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 1 world');
			await expectMarkers(canvasElement, 0);
		});

		await step('2 · send: the monitor shows what the implementation emitted, still unreconciled', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Send events to the implementation' }));
			await waitFor(() => expect(monitor()).toHaveTextContent('20 <- seq 1'));
			await expect(canvas.getByTestId('monitor-1')).toHaveTextContent('on 1|F|10|20 → 20 <- seq 1');
			await expect(canvas.getByTestId('monitor-2')).toHaveTextContent('on 2|S|20 → 10 <- seq 2');
			await expect(canvas.getByTestId('monitor-3')).toHaveTextContent('no delivery');
			await expect(monitor()).not.toHaveTextContent('awaiting send');
			await expectMarkers(canvasElement, 0);
			await expectMarkers(canvasElement, 0);
		});

		await step('3 · evaluate baseline: green, with the warning beside it, readable without hovering', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			const warning = 'This ordering passes, but this model fails 20 of the other 23. Test all 24 orderings.';
			await pageShows(canvasElement, '-> pass');
			await pageShows(canvasElement, warning); // a line of the editor (a comment: the log's, not the learner's), not a marker message
			await expectMarkers(canvasElement, 1);
			const [marker] = markers(canvasElement);
			await expect(marker.severity).toBe(4); // MarkerSeverity.Warning: not an error, the baseline did pass
			await expect(marker.message).toBe(warning);
			await lensesRendered(canvasElement, 1);
			// The lens says it in words and is marked as a warning, not as a failure.
			const [lens] = lensTexts(canvasElement);
			await expect(lens).toContain('⚠ passes here, fails 20 of the other 23');
			await expect(lens).not.toContain('✗');
			await expect(lens).not.toContain('lesson-baseline-nondiscriminating');
			await expect(footer()).toHaveTextContent('1 pass · 0 missing · 0 forbidden · 0 both');
		});

		await step('4 · transform: the same four events in 24 arrival orders, axiom unchanged', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Transform arrival order' }));
			await pageShows(canvasElement, '[4,2,3,1]');
			await waitFor(() => expect(editorLines(canvasElement)).toHaveLength(24));
			await expectMarkers(canvasElement, 0);
			await expect(canvas.getByTestId('chip-1234')).toHaveTextContent('20 <- seq 1, 10 <- seq 2'); // the monitor becomes one row per run
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 24 worlds');
			await expect(footer()).toHaveTextContent('not evaluated');
		});

		await step('5 · evaluate family: four outcomes told apart in the grid, the log and the lenses', async () => {
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			await lensesRendered(canvasElement, 20);
			const found = markers(canvasElement);
			await expectMarkers(canvasElement, 20);
			await expect(found.every((marker) => marker.severity === 8)).toBe(true); // MarkerSeverity.Error
			await expect(footer()).toHaveTextContent('4 pass · 12 missing · 4 forbidden · 4 both');
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 24 worlds');

			// The grid: 24 chips, each spelling out its outcome, in the table's counts.
			const chips = canvas.getAllByTestId(/^chip-/);
			await expect(chips).toHaveLength(24);
			const outcomes = (outcome: string) => chips.filter((chip) => chip.dataset.outcome === outcome);
			await expect([outcomes('pass'), outcomes('missing'), outcomes('forbidden'), outcomes('both')].map((c) => c.length)).toEqual([4, 12, 4, 4]);
			await expect(canvas.getByTestId('chip-1234')).toHaveTextContent('pass');
			await expect(canvas.getByTestId('chip-1324')).toHaveTextContent('missing');
			await expect(canvas.getByTestId('chip-1243')).toHaveTextContent('forbidden');
			await expect(canvas.getByTestId('chip-1432')).toHaveTextContent('both');

			// The log: every row now names its outcome, so a pass no longer looks unevaluated.
			const lines = editorLines(canvasElement);
			for (const [name, label] of [['[1,2,3,4]', 'pass'], ['[1,3,2,4]', 'missing'], ['[1,2,4,3]', 'forbidden'], ['[1,4,3,2]', 'both']]) {
				await expect(lines.find((line) => line.startsWith(name))).toMatch(new RegExp(`-> ${label}$`));
			}
			// The lenses: a "both" row says both, instead of surfacing as its first code.
			const lenses = lensTexts(canvasElement);
			await expect(lenses.filter((text) => text.includes('both: missing 10 <- seq 2, forbidden 10 <- seq 4'))).toHaveLength(4);
			await expect(lenses.filter((text) => text.includes('forbidden 10 <- seq 4') && !text.includes('both'))).toHaveLength(4);
			await expect(lenses.some((text) => text.includes('fm-'))).toBe(false);
			await expect(canvas.getByTestId('repair-row')).toBeVisible();
		});

		await step('6 · open a failing world: [4,2,3,1] enters the channels, its divergence shows in the diagnostic', async () => {
			// The chip selects an execution: the same four events, sent in a different order (its editor line is the input).
			await userEvent.click(canvas.getByTestId('chip-4231'));
			await expect(canvas.getByTestId('chip-4231')).toHaveAttribute('aria-pressed', 'true');
			await expect(canvas.getByTestId('chip-4231')).toHaveTextContent('20 <- seq 1'); // the run delivered seq 1 and nothing else
			await expect(canvas.getByTestId('chip-4231')).not.toHaveTextContent('10 <- seq 2'); // seq 2 goes nowhere: 20 has no followers yet
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
			// Expected and actual side by side; the delivery the witness never made
			// holds its expected position as a dashed placeholder.
			const text = doc.querySelector('.evidence-widget')!.textContent!;
			await expect(text).toMatch(/row\s+expected\s+\| actual/);
			await expect(text).toMatch(/1\/2\s+10 <- seq 2\s+\| -- missing --\s+\[missing\]/);
			await expect(text).toMatch(/2\/2\s+20 <- seq 1\s+\| 20 <- seq 1\s+\[ok\]/);
			// Each pair is one line of the widget: none wraps, so the columns stay aligned.
			const pairRows = Array.from(doc.querySelectorAll<HTMLElement>('.evidence-widget div')).filter((row) => /\(vs\)/.test(row.textContent ?? ''));
			await expect(pairRows).toHaveLength(3);
			await expect(new Set(pairRows.map((row) => row.getBoundingClientRect().height)).size).toBe(1);

			// The repair row tells the action from the conceptual repairs.
			const repairs = within(canvas.getByTestId('repair-row'));
			await expect(repairs.getByRole('button', { name: /reorder-buffer/ })).toBeEnabled();
			await expect(repairs.getAllByRole('button')).toHaveLength(1);
			await expect(repairs.getByText(/change world/).closest('li')).toHaveTextContent('conceptual, not available here');
			await expect(repairs.getByText(/change axiom/).closest('li')).toHaveTextContent('conceptual, not available here');
		});

		await step('7 · change model, in place: the same family reruns and [4,2,3,1] now passes', async () => {
			await userEvent.click(within(canvas.getByTestId('repair-row')).getByRole('button', { name: /reorder-buffer/ }));
			await waitFor(() => expect(footer()).toHaveTextContent('24 pass · 0 missing · 0 forbidden · 0 both'));
			await expect(canvas.getByRole('combobox')).toHaveValue('reorder-buffer');
			// The same conversation, rerun: [4,2,3,1] is still selected and the monitor now shows the fix.
			await expect(canvas.getByTestId('chip-4231')).toHaveTextContent('20 <- seq 1, 10 <- seq 2');
			await expect(canvas.getByTestId('chip-4231')).toHaveAttribute('data-outcome', 'pass');
			await expect(canvas.getAllByTestId(/^chip-/).filter((chip) => chip.dataset.outcome !== 'pass')).toHaveLength(0);
			await expectMarkers(canvasElement, 0);
			await pageShows(canvasElement, '[4,2,3,1]');
			await waitFor(() => expect(editorLines(canvasElement).find((line) => line.startsWith('[4,2,3,1]'))).toMatch(/-> pass$/));
			await expect(badge()).toHaveTextContent('followerMaze.orderedRouting · 24 worlds'); // one axiom throughout
			await expect(canvas.queryByTestId('repair-row')).toBeNull();
		});
	},
};

// The Workbench with no play(): open it with `viewMode=story` and drive it by hand
// (or with playwright-cli) to stop at any storyboard frame. Storybook cannot start a
// play() at step N, so a frame is reached by replaying the learner's actions.
export const Playground: Story = {
	render: () => <Workbench model="arrival-order" height={TALL} />,
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
			await waitFor(() => typeReasons(canvasElement, TIGHT_REASONS), { timeout: 15000 });
			await pageShows(canvasElement, 'status|20 -> []');
			await userEvent.click(canvas.getByRole('button', { name: 'Send events to the implementation' }));
			await waitFor(() => expect(canvas.getByTestId('monitor-channel')).toHaveTextContent('10 <- seq 2'));
			await userEvent.click(canvas.getByRole('button', { name: 'Evaluate' }));
			await pageShows(canvasElement, '-> pass');
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
