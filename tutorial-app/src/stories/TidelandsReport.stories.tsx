import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsReport from '../components/TidelandsReport';

const meta = {
  title: 'Tidelands/Report',
  component: TidelandsReport,
} satisfies Meta<typeof TidelandsReport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Liar: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'This sentence is false.' })).toBeVisible();
    await expect(canvas.getAllByText('Not run')).toHaveLength(2);
    await expect(canvas.getByText('Missed')).toBeVisible();
  },
};
