import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';
import baselineStarter from '../content/tutorial/part-5/private-document/1-is-the-private-document-private/_files/acp-trace.json';
import baselineSolved from '../content/tutorial/part-5/private-document/1-is-the-private-document-private/_solution/acp-trace.json';
import patchedStarter from '../content/tutorial/part-5/private-document/2-does-the-owner-check-keep-the-document-private/_files/acp-trace.json';
import patchedSolved from '../content/tutorial/part-5/private-document/2-does-the-owner-check-keep-the-document-private/_solution/acp-trace.json';

const meta = {
  title: 'Lessons/Private document',
  parameters: { layout: 'padded', controls: { include: ['solved'] } },
  argTypes: { solved: { control: 'boolean' } },
  args: { solved: false },
} satisfies Meta<{ solved: boolean }>;
export default meta;
type Story = StoryObj<typeof meta>;

const fixture = { data: {}, files: {}, solved: {}, focus: '' } satisfies Lesson;
const config = { traceFile: '/acp-trace.json', scenario: 'cit294-review-v1' };

// Part 5 runs the Client alone; agent activity is the lesson's terminal.
// Read the generated lesson traces directly, so the toggle reveals the same
// recorded reply as TutorialKit's Solve without maintaining another fixture.
export const Baseline: Story = {
  name: 'Is the private document private?',
  render: ({ solved }) => (
    <AcpTracePreview
      agent={false}
      payload={deriveAcpTraceState(fixture, {
        '/acp-trace.json': JSON.stringify(solved ? baselineSolved : baselineStarter),
      }, { config })}
      height={640}
    />
  ),
};

export const OwnerCheck: Story = {
  name: 'Does the owner check keep the document private?',
  render: ({ solved }) => (
    <AcpTracePreview
      agent={false}
      payload={deriveAcpTraceState(fixture, {
        '/acp-trace.json': JSON.stringify(solved ? patchedSolved : patchedStarter),
      }, { config })}
      height={640}
    />
  ),
};
