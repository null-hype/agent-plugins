import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';

// Part 5, "Can an upload read a private file?", as the tutorial reporter generated
// it: one story per lesson, each a pull request and its review. With `solved`, the
// lesson's `_solution` lies over its `_files`, as TutorialKit's Solve leaves them,
// and Peek opens the lesson's own files where the evidence names one.
const meta = {
  title: 'Lessons/Private file',
  parameters: { layout: 'padded', controls: { include: ['solved'] } },
  argTypes: { solved: { control: 'boolean' } },
  args: { solved: false },
} satisfies Meta<{ solved: boolean }>;
export default meta;
type Story = StoryObj<typeof meta>;

const chapter = '../content/tutorial/part-5/can-an-upload-read-a-private-file/';
const all = import.meta.glob<string>('../content/tutorial/part-5/can-an-upload-read-a-private-file/*/{_files,_solution}/**/*', { query: '?raw', import: 'default', eager: true });

/** A lesson's files by their lesson path (`/acp-trace.json`), solved or not. */
function lessonFiles(lesson: string, solved: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  for (const kind of solved ? ['_files', '_solution'] : ['_files']) {
    const prefix = `${chapter}${lesson}/${kind}`;
    for (const [key, body] of Object.entries(all)) if (key.startsWith(`${prefix}/`)) files[key.slice(prefix.length)] = body;
  }
  return files;
}

const fixture = { data: {}, files: {}, solved: {}, focus: '' } satisfies Lesson;
const config = { traceFile: '/acp-trace.json', scenario: 'cit294-review-v1' };
const render = (lesson: string) => ({ solved }: { solved: boolean }) => (
  <AcpTracePreview agent={false} payload={deriveAcpTraceState(fixture, lessonFiles(lesson, solved), { config })} height={640} />
);

export const PR117: Story = {
  name: '#117: Can the check tell a real read of the private file from a forged one?',
  render: render('1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one'),
};

export const PR118: Story = {
  name: '#118: Can the strengthened check tell a real read of the private file from a forged one?',
  render: render('2-can-the-strengthened-check-tell-a-real-read-of-the-private-file-from-a-forged-one'),
};
