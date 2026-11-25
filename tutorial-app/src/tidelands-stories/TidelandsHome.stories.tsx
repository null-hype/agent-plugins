import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsHome from '../components/TidelandsHome';

const meta = { title: 'Tidelands/Home', component: TidelandsHome, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TidelandsHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Build tools people can trust and inspect.');
    await expect(canvas.getByRole('region', { name: 'Delta thread' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'richard@tidelands.dev' })).toHaveAttribute('href', 'mailto:richard@tidelands.dev');
  },
};
