import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { load } from 'js-yaml';
import AcpTraceBridge from '../components/AcpTraceBridge';
import tutorialStore, { resetTutorialStore, seedTutorialStore } from '../../.storybook/tutorialkit-store';

// One story for each real lesson. Solve/Reset use the same store methods as
// TutorialKit; the bridge reads the seeded files and drives the Client.
function StoreBackedPreview({ solved }: { solved: boolean }) {
  useEffect(() => {
    if (solved) tutorialStore.solve();
    else tutorialStore.reset();
  }, [solved]);

  return (
    <>
      <AcpTraceBridge traceFile="/acp-trace.json" scenario="cit294-review-v1" />
      <div className="previews-container">
        <AcpTracePreview agent={false} height={640} />
      </div>
    </>
  );
}

const meta = {
  title: 'Lessons/Private file',
  parameters: { layout: 'padded', controls: { include: ['solved'] } },
  argTypes: { solved: { control: 'boolean' } },
  args: { solved: false },
  render: (args) => <StoreBackedPreview solved={args.solved} />,
} satisfies Meta<{ solved: boolean }>;
export default meta;
type Story = StoryObj<typeof meta>;

const chapter = '../content/tutorial/part-5/can-an-upload-read-a-private-file/';
const all = import.meta.glob<string>('../content/tutorial/part-5/can-an-upload-read-a-private-file/*/{content.mdx,_files/**/*,_solution/**/*}', { query: '?raw', import: 'default', eager: true });

/** A lesson's files by their lesson path (`/acp-trace.json`), solved or not. */
function lessonFiles(lesson: string, solved: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  for (const kind of solved ? ['_files', '_solution'] : ['_files']) {
    const prefix = `${chapter}${lesson}/${kind}`;
    for (const [key, body] of Object.entries(all)) if (key.startsWith(`${prefix}/`)) files[key.slice(prefix.length)] = body;
  }
  return files;
}

function seedLesson(lesson: string) {
  return () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(all[`${chapter}${lesson}/content.mdx`]);
    if (!frontmatter) throw new Error(`no frontmatter for ${lesson}`);
    const data = load(frontmatter[1]) as Record<string, unknown>;
    seedTutorialStore({
      data,
      files: lessonFiles(lesson, false),
      solution: lessonFiles(lesson, true),
      focus: String(data.focus),
    });
    return resetTutorialStore;
  };
}

export const PR117: Story = {
  name: '#117: Can the check tell a real read of the private file from a forged one?',
  beforeEach: seedLesson('1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one'),
};

export const PR118: Story = {
  name: '#118: Can the strengthened check tell a real read of the private file from a forged one?',
  beforeEach: seedLesson('2-can-the-strengthened-check-tell-a-real-read-of-the-private-file-from-a-forged-one'),
};

export const PR120: Story = {
  name: '#120: Can the check tell a real read of the private file from a mention of one?',
  beforeEach: seedLesson('3-can-the-check-tell-a-real-read-of-the-private-file-from-a-mention-of-one'),
};

export const CC23E89: Story = {
  name: 'cc23e89: Does the check require a real read of the private file?',
  beforeEach: seedLesson('4-does-the-check-require-a-real-read-of-the-private-file'),
};
