import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import TidelandsHome from '../components/TidelandsHome';

const meta = { title: 'Tidelands/Home', component: TidelandsHome, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TidelandsHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Build tools people can trust and inspect.');
    const replay = canvas.getByRole('region', { name: 'Handoff replay' });
    await expect(replay).toBeVisible();
    const thread = within(replay);
    await expect(thread.getAllByRole('img', { name: 'Richard', exact: true })).toHaveLength(3);
    for (const name of ['Backend agent → UI agent', 'UI agent · handoff only', 'UI agent · with delta-zero']) {
      await expect(thread.getByRole('img', { name })).toBeVisible();
    }
    await expect(thread.getByRole('link', { name: 'richard@tidelands.dev' })).toHaveAttribute('href', 'mailto:richard@tidelands.dev');
  },
};
