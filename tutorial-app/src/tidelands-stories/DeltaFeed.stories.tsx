import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import DeltaFeed from '../components/DeltaFeed';
import homepage from '../feed/homepage.recording.json';
import signalHierarchy from '../feed/signal-hierarchy.recording.json';
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
  args: { recording: homepage as ReplayRecording, end: <ThreadInvite /> },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('link', { name: 'Next ↓' }).at(-1)!);
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Want to inspect the rest of this run?' })).toBeVisible());
  },
};

export const SignalHierarchy: Story = {
  play: async ({ canvas }) => {
    const feed = canvas.getByRole('region', { name: 'Delta thread' });
    await expect(feed.querySelectorAll('.df-step').length).toBeGreaterThan(1);
  },
};

export const OpenAtFrame: Story = { args: { initialFrameId: 'f10' } };

export const LiveAppend: Story = {
  play: async ({ canvas }) => {
    const feed = canvas.getByRole('region', { name: 'Delta thread' });
    const cards = feed.querySelectorAll('.df-msg').length;
    const recording = signalHierarchy as ReplayRecording;
    const frame = { ...recording.frames[0], frameId: 'live-1', order: recording.frames.length };
    window.postMessage({ type: 'trace.append', frame }, window.location.origin);
    await waitFor(() => expect(feed.querySelectorAll('.df-msg').length).toBe(cards + 1));
  },
};
