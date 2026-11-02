import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsHero from '../components/TidelandsHero';

const meta = {
  title: 'Tidelands/Hero',
  component: TidelandsHero,
} satisfies Meta<typeof TidelandsHero>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NameOnly: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Richard Anthony' })).toBeVisible();
    await expect(canvas.queryAllByRole('link')).toHaveLength(0);
  },
};
