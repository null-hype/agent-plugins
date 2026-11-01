import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsHome from '../components/TidelandsHome';

const meta = { title: 'Tidelands/Home', component: TidelandsHome, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TidelandsHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

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
