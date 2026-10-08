import type { Meta, StoryObj } from '@storybook/react-vite';
import { RansomNote } from '../components/RansomNote';

// The Stitch "Tidelands Ransom Note Portfolio" lettering (CIT-340), on its own
// dark paper and on the tutorial's light background.
const meta: Meta<typeof RansomNote> = {
  title: 'Brand/Ransom note',
  component: RansomNote,
  parameters: { layout: 'fullscreen' },
  args: { text: 'TIDELANDS', size: 48, seed: 0 },
  argTypes: { size: { control: { type: 'range', min: 16, max: 96 } }, seed: { control: { type: 'number' } } },
  render: (args) => (
    <>
      <div style={{ background: '#141313', padding: '56px 40px' }}>
        <RansomNote {...args} />
      </div>
      <div style={{ background: '#ffffff', padding: '56px 40px' }}>
        <RansomNote {...args} />
      </div>
    </>
  ),
};
export default meta;

export const Wordmark: StoryObj<typeof meta> = {};

export const LessonTitle: StoryObj<typeof meta> = {
  args: { text: 'What does a passing check tell you?', size: 36, seed: 3 },
};
