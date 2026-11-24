import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsHome from '../components/TidelandsHome';

const meta = { title: 'Tidelands/Home', component: TidelandsHome, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TidelandsHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Compiler warnings for context loss.');
    await userEvent.click(canvas.getByRole('link', { name: 'See the demo ↓' }));
    await expect(canvas.getByRole('heading', { name: 'The summary said implement. The source said wait.' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Read the code ↗' })).toHaveAttribute('href', 'https://github.com/null-hype/agent-plugins/tree/delta-zero');
    await userEvent.click(canvas.getByRole('link', { name: 'Inspect public evidence ↓' }));
    await expect(canvas.getByRole('link', { name: 'Read prompts, replies and limits ↗' })).toHaveAttribute('href', 'https://github.com/null-hype/agent-plugins/blob/delta-zero/examples/yoars-handoff/AGENT-RUN.md');
  },
};

export const InspectAndRepair: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Evaluate integration' }));
    await expect(canvas.getByText('Failed', { selector: '.ic-failed' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Inspect disagreement' }));
    await expect(canvas.getByText('Governing rule')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Apply repair (revises candidate B)' }));
    await expect(canvas.getByText('Stale: inputs changed')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Re-evaluate integration' }));
    await expect(canvas.getByRole('button', { name: 'Approve landing (simulated)' })).toBeVisible();
    await expect(canvas.getByText('Not approved')).toBeVisible();
  },
};
