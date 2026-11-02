import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsContact from '../components/TidelandsContact';

const meta = {
  title: 'Tidelands/Contact',
  component: TidelandsContact,
} satisfies Meta<typeof TidelandsContact>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmailAndLinkedIn: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'richard@tidelands.dev' })).toHaveAttribute('href', 'mailto:richard@tidelands.dev');
    await expect(canvas.getByRole('link', { name: 'LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/richardanthonydev/');
  },
};
