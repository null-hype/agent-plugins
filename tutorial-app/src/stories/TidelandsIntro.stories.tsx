import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import TidelandsIntro from '../components/TidelandsIntro';

const meta = {
  title: 'Tidelands/Intro',
  component: TidelandsIntro,
} satisfies Meta<typeof TidelandsIntro>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneSentence: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Verification infrastructure for agent-produced software.')).toBeVisible();
    await expect(canvas.queryAllByRole('link')).toHaveLength(0);
  },
};
