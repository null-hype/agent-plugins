import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import AcpTracePreview from './AcpTracePreview';
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
