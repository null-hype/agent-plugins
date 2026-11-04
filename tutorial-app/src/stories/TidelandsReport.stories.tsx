import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsReport from '../components/TidelandsReport';

const meta = {
  title: 'Tidelands/Report',
  component: TidelandsReport,
} satisfies Meta<typeof TidelandsReport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Checks' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: "An agent's work is judged against predictions registered before its plan was approved." }))
      .toHaveAttribute('href', 'https://check.tidelands.dev/preserve-preregistered-delivery-claims-across-an-observed-world');
    await expect(canvas.getByText('Passed')).toBeVisible();
  },
};
