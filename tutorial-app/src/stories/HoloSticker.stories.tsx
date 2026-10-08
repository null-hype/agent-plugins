import type { Meta, StoryObj } from '@storybook/react-vite';
import { HoloSticker } from '../components/HoloSticker';
import { RansomNote } from '../components/RansomNote';

// The holographic sticker motif (CIT-340) on the grey card ground of the
// TypeSafe reference, next to the ransom lettering and mono labels it pairs with.
const label: React.CSSProperties = {
  font: "700 12px/1.4 'Space Mono', monospace",
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: '#1c1c17',
};

const meta: Meta<typeof HoloSticker> = {
  title: 'Brand/Holo sticker',
  component: HoloSticker,
  parameters: { layout: 'fullscreen' },
  args: { size: 180, tilt: -8 },
  argTypes: { size: { control: { type: 'range', min: 48, max: 320 } }, tilt: { control: { type: 'range', min: -30, max: 30 } } },
  render: (args) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 32,
        minHeight: 360,
        padding: '48px 56px',
        background: '#ececec',
      }}
    >
      <div style={{ display: 'grid', gap: 18 }}>
        <span style={label}>Instructions</span>
        <RansomNote text="Trust The Check?" size={40} seed={3} />
        <span style={label}>Output ⟶ 1290 / 1200 · fails v1</span>
      </div>
      <HoloSticker {...args} />
    </div>
  ),
};
export default meta;

export const OnCard: StoryObj<typeof meta> = {};

export const Small: StoryObj<typeof meta> = { args: { size: 72, tilt: 6 } };
