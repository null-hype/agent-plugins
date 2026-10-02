import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, loadLesson } from './lessonFixtures';
import recorded from './fixtures/jev-recorded-run.json';

type Args = { solved: boolean; frameId: string; question: number };
const ids = Object.keys(recorded.comparison.questions);
const lessons = [
  loadLesson('part-5/private-document/1-reproduce-the-flaw'),
  loadLesson('part-5/private-document/2-block-unauthorized-access'),
  loadLesson('part-5/private-document/3-preserve-owner-access'),
];
const meta: Meta<Args> = {
  title: 'Lessons/Jev recorded diagnostics',
  parameters: { layout: 'padded', docs: { story: { autoplay: false } } },
  args: { solved: false, frameId: '', question: 0 },
  argTypes: {
    solved: { control: 'boolean' },
    frameId: { control: 'text', description: 'Question id followed by :evidence or :evaluation; includes adjacent frames.' },
    question: { table: { disable: true }, control: false },
  },
  render: args => <AcpTracePreview payload={deriveAcpTraceState(lessons[args.question], args.solved || args.frameId ? lessons[args.question].solved : lessons[args.question].files, { frameId: args.frameId })} height={640} />,
  play: async ({ canvasElement, args }) => {
    await waitFor(() => {
      const doc = canvasElement.querySelector('iframe')?.contentDocument;
      expect(doc?.querySelector('.monaco-editor .view-line')).toBeTruthy();
      const text = doc?.body.textContent ?? '';
      expect(text).toContain(ids[args.question]);
      const agent = canvasElement.querySelectorAll('iframe')[1]?.contentDocument;
      const report = agent?.querySelector('#jev-view')?.shadowRoot;
      expect(report?.querySelector('#detail')?.textContent).toContain('Expected range');
      if (!args.frameId) {
        expect(report?.querySelector('#detail')?.textContent).toContain(args.solved ? `${[96, 97, 98][args.question]}%` : 'Not scored');
        const score = `Jev ${[96, 97, 98][args.question]}%`;
        if (args.solved) expect(text).toContain(score);
        else expect(text).not.toContain(score);
      }
    }, { timeout: 20000 });
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const ReproduceVulnerability: Story = { name: 'Can Alice read Bob’s private document?' };
export const PreventExploit: Story = { name: 'Does the ownership check block Alice?', args: { question: 1 } };
export const PreserveAccess: Story = { name: 'Can Bob still read his own document?', args: { question: 2 } };
