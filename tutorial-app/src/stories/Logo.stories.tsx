import type { Meta, StoryObj } from '@storybook/react-vite';
import logo from '../../public/logo.svg?url';
import logoDark from '../../public/logo-dark.svg?url';

// The top bar logo (CIT-332) on both top bar themes, at the bar's 2rem size and enlarged.
const Bar = ({ src, background, size }: { src: string; background: string; size: number }) => (
  <div style={{ background, display: 'flex', alignItems: 'center', gap: 24, padding: '12px 16px', minHeight: 56 }}>
    <img src={src} alt="Tidelands" style={{ height: 32 }} />
    <img src={src} alt="" style={{ height: size }} />
  </div>
);

const meta: Meta<{ size: number }> = {
  title: 'Brand/Top bar logo',
  parameters: { layout: 'fullscreen' },
  args: { size: 160 },
  render: ({ size }) => (
    <>
      <Bar src={logo} background="#ffffff" size={size} />
      <Bar src={logoDark} background="#171717" size={size} />
    </>
  ),
};
export default meta;

export const Default: StoryObj<typeof meta> = {};
