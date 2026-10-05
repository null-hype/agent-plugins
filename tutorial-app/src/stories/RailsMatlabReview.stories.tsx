import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AcpTraceConfig } from '../lib/acpTraceProtocol';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';
import starter from './fixtures/rails-matlab-review-1.starter.json';
import solved from './fixtures/rails-matlab-review-1.solved.json';

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
			height={640}
		/>
	),
};

export const Lesson2Placeholder: Story = {
    args: {
        solved: true
    },

    name: "Can the check in #117 be trusted?",

    render: (
        {
            solved: isSolved
        }
    ) => (<AcpTracePreview
        payload={deriveAcpTraceState(fixture, {
            "/acp-trace.json": JSON.stringify(isSolved ? solved : starter)
        }, {
            config
        })}
        height={640} />)
};
