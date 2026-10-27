import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { PortfolioLanding } from '../components/PortfolioLanding';

const meta = {
  title: 'Portfolio/Landing',
  component: PortfolioLanding,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
} satisfies Meta<typeof PortfolioLanding>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FrontDoor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const proof = canvas.getByRole('link', { name: 'Inspect the Worlds proof' });
    await expect(proof).toHaveAttribute('href', 'https://github.com/null-hype/worlds#start-here-one-exact-world-proof');
    const workLink = canvas.queryByRole('link', { name: 'The work', exact: true });
    if (workLink) {
      await userEvent.click(workLink);
      await expect(canvasElement.ownerDocument.location.hash).toBe('#evidence');
    }
    await userEvent.click(canvas.getByRole('link', { name: 'Get in touch' }));
    await expect(canvasElement.ownerDocument.location.hash).toBe('#work');
    await expect(canvas.getByRole('link', { name: 'public.rant@pm.me' })).toHaveAttribute('href', 'mailto:public.rant@pm.me');
    const skip = canvas.getByRole('link', { name: 'Skip to content' });
    skip.focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('main')).toHaveFocus();
  },
};
