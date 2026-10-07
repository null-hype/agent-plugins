import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';

// Part 5's "Shared model" chapter as the tutorial reporter generated it. Each
// story is one lesson: its `_files`, and with `solved`, those files with its
// `_solution` over them, as TutorialKit's Solve leaves them. Peek shows the
// lesson's own files where the evidence names one.
const meta = {
  title: 'Lessons/Shared model',
  parameters: { layout: 'padded', controls: { include: ['solved'] } },
  argTypes: { solved: { control: 'boolean' } },
  args: { solved: false },
} satisfies Meta<{ solved: boolean }>;
export default meta;
type Story = StoryObj<typeof meta>;

const chapter = '../content/tutorial/part-5/shared-model/';
const all = import.meta.glob<string>('../content/tutorial/part-5/shared-model/*/{_files,_solution}/**/*', { query: '?raw', import: 'default', eager: true });

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

export const Committed: Story = {
  name: 'Does the committed model keep the document private?',
  render: render('1-does-the-committed-model-keep-the-document-private'),
};

export const AliceEdit: Story = {
  name: "Does the model catch Alice's edit?",
  render: render('2-does-the-model-catch-alice-s-edit'),
};

export const Loosened: Story = {
  name: 'Does a passing model mean the document is private?',
  render: render('3-does-a-passing-model-mean-the-document-is-private'),
};
