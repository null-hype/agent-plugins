import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { expect, waitFor } from 'storybook/test';
import { clientDocument, clientText, clickInFrame, editorsReady, expectClientShows, pressClientTab } from './acpTracePlay';
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

function seedLesson(lesson: string) {
  return () => {
    seedTutorialStore({
      data: {},
      files: lessonFiles(lesson, false),
      solution: lessonFiles(lesson, true),
      focus: '/acp-trace.json',
    });
    return resetTutorialStore;
  };
}

const probe = 'Does the check fail when a read of the private file is forged?';

function playLesson(commit: string, code: string, mark: string): NonNullable<Story['play']> {
  return async ({ canvasElement, args, step }) => {
    await editorsReady(canvasElement, 1);
    // Keep the existing solved control useful for inspecting a solved lesson.
    if (args.solved) {
      await expectClientShows(canvasElement, probe);
      return;
    }

    await step('Alice commit, before Solve', async () => {
      // The Client folds the commit body under its subject by default.
      // Folding arrives after Monaco renders its first line, especially in
      // the production build. Wait for it before clicking the commit open.
      const fold = await waitFor(() => {
        const control = clientDocument(canvasElement)?.querySelector<HTMLElement>('.codicon-folding-collapsed');
        if (!control) throw new Error('folded Alice commit not found');
        return control;
      });
      clickInFrame(fold);
      await expectClientShows(canvasElement, commit);
      await expect(clientText(canvasElement)).not.toContain(probe);
    });
    await step('Solve offers the probe', async () => {
      tutorialStore.solve();
      await expectClientShows(canvasElement, probe);
    });
    await step('Tab reveals the finding', async () => {
      pressClientTab(canvasElement);
      await waitFor(() => {
        const lens = Array.from(clientDocument(canvasElement)?.querySelectorAll<HTMLElement>('.codelens-decoration a') ?? [])
          .find((el) => el.textContent?.includes(code));
        if (!lens) throw new Error(`finding lens ${code} not shown`);
        expect(lens).toBeVisible();
        expect(lens.textContent).toContain(mark);
      });
    });
    await step('Reset restores the starter', async () => {
      tutorialStore.reset();
      await waitFor(() => expect(clientText(canvasElement)).not.toContain(probe));
    });
  };
}

export const PR117: Story = {
  play: playLesson('Alice, #117:', 'review-1.finding-1.forged-read', '✗'),
  name: '#117: Can the check tell a real read of the private file from a forged one?',
  beforeEach: seedLesson('1-can-the-check-tell-a-real-read-of-the-private-file-from-a-forged-one'),
};

export const PR118: Story = {
  play: playLesson('Alice, #118:', 'review-2.gap-1.forged-read', '✗'),
  name: '#118: Can the strengthened check tell a real read of the private file from a forged one?',
  beforeEach: seedLesson('2-can-the-strengthened-check-tell-a-real-read-of-the-private-file-from-a-forged-one'),
};

export const PR120: Story = {
  play: playLesson('Alice, #120:', 'review-2.gap-1.forged-read', 'ℹ'),
  name: '#120: Can the check tell a real read of the private file from a mention of one?',
  beforeEach: seedLesson('3-can-the-check-tell-a-real-read-of-the-private-file-from-a-mention-of-one'),
};

export const CC23E89: Story = {
  play: playLesson('Alice, cc23e89', 'review-2.gap-1.forged-read', 'ℹ'),
  name: 'cc23e89: Does the check require a real read of the private file?',
  beforeEach: seedLesson('4-does-the-check-require-a-real-read-of-the-private-file'),
};
