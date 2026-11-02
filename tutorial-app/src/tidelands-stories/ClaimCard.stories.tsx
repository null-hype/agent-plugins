import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import ClaimCard from '../components/ClaimCard';

// Display fixtures, not published claims.
const meta = {
  title: 'Tidelands/Claim card',
  component: ClaimCard,
  args: { identifier: 'DEMO-1', title: 'Preserve a claim across an observed world', exit: 0, check: 'registered-delivery', preregistered: true, href: '#report' },
  decorators: [Story => <div className="td-page" style={{ padding: 24, maxWidth: 520, minHeight: 0 }}><Story /></div>],
} satisfies Meta<typeof ClaimCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PassingPreregistered: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Green · Passed')).toBeVisible();
    await expect(canvas.getByText('Preregistration attached')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Preserve a claim across an observed world' })).toHaveAttribute('href', '#report');
  },
};

export const Failing: Story = {
  args: { identifier: 'DEMO-2', exit: 1 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Red · Failed')).toBeVisible();
    await expect(canvas.getByText(/Dagger exit 1/)).toBeVisible();
  },
};

export const WithoutPreregistration: Story = {
  args: { preregistered: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText('Preregistration attached')).toBeNull();
  },
};
