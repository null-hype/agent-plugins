import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsHome from '../components/TidelandsHome';
import ResearchPage from '../components/ResearchPage';

const meta = { title: 'Tidelands/Home', component: TidelandsHome, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TidelandsHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Richard Anthony' })).toBeVisible();
    await expect(canvas.getAllByRole('link', { name: 'Discuss a project' })[0]).toBeVisible();
  },
};

export const Research: StoryObj<typeof ResearchPage> = {
  render: () => <ResearchPage />,
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
