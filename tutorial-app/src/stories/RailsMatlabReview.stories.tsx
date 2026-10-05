import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AcpTraceConfig } from '../lib/acpTraceProtocol';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';
import starter from './fixtures/rails-matlab-review-1.starter.json';
import solved from './fixtures/rails-matlab-review-1.solved.json';
import starterTwo from './fixtures/rails-matlab-review-2.starter.json';
import solvedTwo from './fixtures/rails-matlab-review-2.solved.json';
import type { EvidenceBundle } from '../lib/evidenceArtifactResolver';
import evidenceBundle from '../content/tutorial/part-4/can-the-checker-be-trusted/1-can-the-check-tell-a-real-file-read-from-a-forged-one/_files/evidence-bundle.json';

type StoryArgs = { solved: boolean };

const meta: Meta<StoryArgs> = {
	title: 'Lessons/Rails MATLAB review',
	parameters: { layout: 'padded', controls: { include: ['solved'] }, docs: { story: { autoplay: false } } },
	argTypes: { solved: { control: 'boolean' } },
	args: { solved: false },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Not a TutorialKit lesson: the fixture supplies the trace directly, so only
// the config matters to deriveAcpTraceState.
const config: AcpTraceConfig = { traceFile: '/acp-trace.json', scenario: 'cit294-review-v1' };
const fixture = { data: {}, files: {}, solved: {}, focus: '' } satisfies Lesson;

export const ReviewOneOfPullRequest117: Story = {
	name: 'Can the check in #117 be trusted?',
	render: ({ solved: isSolved }) => (
		<AcpTracePreview
			payload={deriveAcpTraceState(fixture, { '/acp-trace.json': JSON.stringify(isSolved ? solved : starter) }, { config })}
			// The lesson's own bundle: the captured file behind the Reconcile.pkl row opens from it.
			evidence={evidenceBundle as EvidenceBundle}
			height={640}
		/>
	),
};

// The same two questions, asked of the checker as PR 118 submitted it. The solved
// fixture's numbers come from the CIT-307 probe run (tests/rails-probes).
export const ReviewTwoOfPullRequest118: Story = {
	name: 'Can the fix in #118 be trusted?',
	render: ({ solved: isSolved }) => (
		<AcpTracePreview
			payload={deriveAcpTraceState(fixture, { '/acp-trace.json': JSON.stringify(isSolved ? solvedTwo : starterTwo) }, { config })}
			height={640}
		/>
	),
};
