import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import DeltaThread from '../components/DeltaThread';
import yoars5484 from '../feed/yoars-5484.recording.json';
import type { ReplayRecording } from '../lib/acpReplayContract';
import { encodeThread } from '../lib/threadLink';
import '../components/Tidelands.css';

/**
 * Renders any Delta thread from a link: a published id, or an encoded
 * projection from `npm run feed:link`, e.g.
 * `iframe.html?id=tidelands-delta-thread--from-link&args=thread:v1-…`
 * or `storybook tools stories preview` with props `{ "thread": "v1-…" }`.
 */
const meta = {
  title: 'Tidelands/Delta thread',
  component: DeltaThread,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="td-page" style={{ minHeight: 0, padding: '0 16px' }}><Story /></div>],
  argTypes: { thread: { control: 'text' }, frame: { control: 'text' } },
  args: { thread: 'signal-hierarchy', allowLinks: true },
} satisfies Meta<typeof DeltaThread>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FromLink: Story = {};

export const Encoded: Story = {
  args: { thread: encodeThread(yoars5484 as ReplayRecording) },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByText('UI agent · with delta-zero')).toBeInTheDocument());
  },
};

export const LinksOffOnTheSite: Story = {
  args: { thread: encodeThread(yoars5484 as ReplayRecording), allowLinks: false },
  play: async ({ canvas }) => {
    // The site ignores the link and shows the homepage thread.
    await waitFor(() => expect(canvas.getByText(/Two agents handed off a task/)).toBeInTheDocument());
  },
};
