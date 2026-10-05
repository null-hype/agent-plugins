import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { expect, waitFor } from 'storybook/test';
import AcpTracePreview from './AcpTracePreview';
import { clickInFrame, clientDocument, clientText, editorsReady, expectClientShows } from './acpTracePlay';
import { deriveAcpTraceState, loadLesson } from './lessonFixtures';

type StoryArgs = ComponentProps<typeof AcpTracePreview> & { solved: boolean };

const meta: Meta<StoryArgs> = {
	title: 'Lessons/Evidence: a recorded diagnostic',
	component: AcpTracePreview,
	parameters: { layout: 'padded', controls: { include: ['solved'] }, docs: { story: { autoplay: false } } },
	argTypes: { solved: { control: 'boolean' } },
	args: { solved: false },
};

export default meta;
type Story = StoryObj<typeof meta>;

const diagnostic = loadLesson('part-2/chapter-1/lesson-1');
const repair = loadLesson('part-2/chapter-1/lesson-2');

// One story per lesson, using its actual starter/solution files. Like the
// Smuggling docs, each preview receives its own payload so the two lessons
// can coexist on the part's docs page without sharing a TutorialKit store.

export const WhereDidThisDiagnosticComeFrom: Story = {
	name: 'Where did this diagnostic come from?',
	render: ({ solved }) => (
		<AcpTracePreview
			payload={deriveAcpTraceState(diagnostic, solved ? diagnostic.solved : diagnostic.files)}
			height={640}
		/>
	),
	// The `solved` control is TutorialKit's Solve button: unsolved shows the
	// pending reply, solved shows the recorded one with its evidence.
	play: async ({ args, canvasElement, step }) => {
		await editorsReady(canvasElement);

		if (!args.solved) {
			await step('The reply is pending: the case is arrival order 4,2,3,1', async () => {
				await expectClientShows(canvasElement, "Why didn't user 10 get the status update from arrival order 4,2,3,1?");
				await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  awaiting recorded turn (Solve replays it)');
				await expect(clientText(canvasElement)).not.toContain('fm-missing-delivery');
			});
			return;
		}

		await step('Solved: the recorded reply appears in the Client pane', async () => {
			await expectClientShows(canvasElement, 'agent: reply with diagnostic  ->  fm-missing-delivery');
		});

		await step('Click fm-missing-delivery: the evidence opens inside the editor', async () => {
			const doc = clientDocument(canvasElement)!;
			// The marked line is a real Monaco error marker on the diagnostic's line.
			await waitFor(() => {
				const monaco = (doc.defaultView as unknown as { monaco?: { editor: { getModelMarkers(f: object): { severity: number; message: string }[] } } }).monaco;
				const markers = monaco?.editor.getModelMarkers({ owner: 'acp-trace' }) ?? [];
				if (!markers.some((m) => m.severity === 8 && m.message.includes('fm-missing-delivery'))) {
					throw new Error('fm-missing-delivery error marker has not been set yet');
				}
			});
			const lens = await waitFor(() => {
				const found = Array.from(doc.querySelectorAll<HTMLElement>('.codelens-decoration a')).find((a) =>
					a.textContent?.includes('fm-missing-delivery'),
				);
				if (!found) throw new Error('fm-missing-delivery CodeLens not found');
				return found;
			});
			clickInFrame(lens);
			await waitFor(() => {
				if (!doc.querySelector('.evidence-widget')) throw new Error('evidence widget did not open');
			});
		});

		await step('Under witness/arrival-order: expected 10 <- seq 2, actual -- missing --', async () => {
			const widget = clientDocument(canvasElement)!.querySelector('.evidence-widget')!;
			const row = Array.from(widget.children).find(
				(r) => r.textContent?.includes('witness/arrival-order') && r.textContent.includes('10 <- seq 2'),
			);
			await expect(row?.textContent).toContain('expected 10 <- seq 2');
			await expect(row?.textContent).toContain('actual -- missing --');
		});
	},
};

export const CheckARepairAgainstTheSameCase: Story = {
	name: 'Check a repair against the same case',
	render: ({ solved }) => (
		<AcpTracePreview
			payload={deriveAcpTraceState(repair, solved ? repair.solved : repair.files)}
			height={640}
		/>
	),
};
