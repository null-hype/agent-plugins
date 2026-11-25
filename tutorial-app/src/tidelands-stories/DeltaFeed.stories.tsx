import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import DeltaFeed from '../components/DeltaFeed';
import homepage from '../feed/homepage.recording.json';
import signalHierarchy from '../feed/signal-hierarchy.recording.json';
import yoars5484 from '../feed/yoars-5484.recording.json';
import ThreadInvite from '../components/ThreadInvite';
import type { ReplayRecording } from '../lib/acpReplayContract';
import '../components/Tidelands.css';

/**
 * One generic story renders any projected Delta thread. Pass a different
 * `recording` (or `initialFrameId`) through `storybook tools stories preview`
 * props to render another thread, or open it at a given frame.
 */
const meta = {
  title: 'Tidelands/Delta feed',
  component: DeltaFeed,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="td-page" style={{ minHeight: 0, padding: '0 16px' }}><Story /></div>],
  args: { recording: signalHierarchy as ReplayRecording },
} satisfies Meta<typeof DeltaFeed>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Homepage: Story = {
  args: { recording: homepage as ReplayRecording, threads: { 'yoars-5484': yoars5484 as ReplayRecording }, end: <ThreadInvite thread={signalHierarchy as ReplayRecording} /> },
  play: async ({ canvas, userEvent }) => {
    for (let i = 0; i < 3; i++) await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'See it on the whole run.' })).toBeVisible());
  },
};

export const SignalHierarchy: Story = {
  play: async ({ canvas, userEvent, step }) => {
    const feed = canvas.getByRole('region', { name: 'Delta thread' });
    await step('step down, step in, back out', async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(feed.textContent).toContain('2 / '));
      const steps = canvas.getAllByRole('button', { name: 'Step in →' });
      await userEvent.click(steps[0]);
      await expect(feed.querySelector('.df-detail')).not.toBeNull();
      await userEvent.click(canvas.getByRole('button', { name: '← Back' }));
      await expect(feed.querySelector('.df-detail')).toBeNull();
    });
  },
};

export const OpenAtFrame: Story = { args: { initialFrameId: 'f10' } };

export const LiveAppend: Story = {
  play: async ({ canvas }) => {
    const feed = canvas.getByRole('region', { name: 'Delta thread' });
    const cards = feed.querySelectorAll('.df-frame').length;
    const recording = signalHierarchy as ReplayRecording;
    const frame = { ...recording.frames[0], frameId: 'live-1', order: recording.frames.length };
    window.postMessage({ type: 'trace.append', frame }, window.location.origin);
    await waitFor(() => expect(feed.querySelectorAll('.df-frame').length).toBe(cards + 1));
  },
};
