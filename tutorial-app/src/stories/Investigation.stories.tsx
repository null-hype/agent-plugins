import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import InvestigationVault, { type Investigation } from './InvestigationVault';

// CIT-365: what a learner sees when an agent's questions meet the one they
// pre-registered, and how they walk into the evidence. Made-up values on the
// private-file case (#117); the snapshot model (CIT-371) supplies them later.

const realRead = '[pid    16] openat(AT_FDCWD</app>, "/work/dummy-canary.txt", O_RDONLY) = 14</work/dummy-canary.txt>';
const canaryReads = (withRead: boolean) => [
  '### ARM: mat-unblocked',
  '== strace openat evidence for the canary/control file ==',
  '[pid    10] openat(AT_FDCWD</app>, "/work/canary.mat", O_RDONLY|O_CLOEXEC) = 6</work/canary.mat>',
  ...(withRead ? [realRead] : []),
  '  "source_path": "/work/canary.mat",',
  '',
].join('\n');

const forgedRead = `{
  "arm": "mat",
  "source_path": "/work/canary.mat",
  "loader_selected": "matload",
  "variant_succeeded": true,
  "returned_bytes_hex": "4b5232532d43414e4152592d4349543239342d30313233343536373839616263",
  "matches_dummy_file": true,
  "recovered_text": "\\"KR2S-CANARY-CIT294-0123456789abc\\""
}
`;

const investigation: Investigation = {
  vault: 'investigations',
  question: 'Can an upload read a private file?',
  agent: [
    {
      tag: 'Does the check fail when a read of the private file is forged?',
      snapshot: '32e5155e',
      evidence: 'Forging the read still left all 28 assertions passing.',
      changes: [
        {
          kind: 'A',
          path: 'inputs/observations/forged-read.json',
          note: "Shouldn't be here: a forged read of the private file, and the check still passed (28 of 28).",
          contents: forgedRead,
          finding: { line: 7, message: 'This read never happened: no process opened /work/dummy-canary.txt (see canary-reads.txt).' },
        },
        {
          kind: 'M',
          path: 'inputs/canary-reads.txt',
          note: 'The real read is gone from the trace.',
          contents: canaryReads(false),
          baseline: canaryReads(true),
        },
      ],
    },
    {
      tag: 'Can the check tell a real block from a generic crash?',
      snapshot: '3c0f3a7e',
      evidence: 'A generic crash made the check fail: 19 of 22 tests passed.',
      changes: [
        {
          kind: 'M',
          path: 'inputs/run_arms.sh',
          note: 'The check failed, but on a crash, not a block.',
          contents: '#!/bin/bash\nset -e\nexit 70  # crash before the arm runs\n',
          baseline: '#!/bin/bash\nset -e\n',
        },
      ],
    },
  ],
};

const meta = {
  title: 'Investigations/Pre-registered question',
  component: InvestigationVault,
  parameters: { layout: 'padded' },
  args: { investigation },
} satisfies Meta<typeof InvestigationVault>;
export default meta;
type Story = StoryObj<typeof meta>;

const text = (root: Element | null, selector: string) =>
  (root?.querySelector(selector)?.textContent ?? '').replace(/ /g, ' ');

// Monaco runs a CodeLens on mouseup, so a plain click() is not enough.
const press = (el: Element) => {
  for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
};
const key = (target: Element | null, name: string, keyCode: number) => {
  (target as HTMLElement | null)?.focus();
  target?.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, keyCode, bubbles: true, cancelable: true }));
};
const lens = (root: Element, label: string) => waitFor(() => {
  const found = Array.from(root.querySelectorAll('.codelens-decoration a, .codelens-decoration span')).find((a) => a.textContent?.includes(label));
  if (!found) throw new Error(`lens "${label}" not shown`);
  return found;
});

const [forged] = investigation.agent;
const [planted] = forged.changes;

/** Slice 1: the vault, its conflict, and Peek on the agent's questions. */
async function openThePeek(canvasElement: HTMLElement, step: (name: string, fn: () => Promise<void>) => Promise<void> | void) {
  await step('the vault shows the question you pre-registered', async () => {
    await waitFor(() => expect(text(canvasElement, '.view-lines')).toContain(investigation.question));
  });

  await step('a squiggle says the vault holds more questions than you declared', async () => {
    await waitFor(() => expect(canvasElement.querySelector('.squiggly-warning')).not.toBeNull());
    // Hovering the squiggle shows the same message; F8 opens it inline.
    const input = canvasElement.querySelector('.monaco-editor textarea, .monaco-editor .native-edit-context');
    key(input, 'F8', 119);
    await waitFor(() => expect(text(canvasElement, '.marker-widget')).toContain('Expected one question, got three.'));
    key(input, 'Escape', 27);
  });

  await step("Peek lists the agent's questions; the first opens on its snapshot's diff", async () => {
    press(await lens(canvasElement, 'Peek'));
    await waitFor(() => {
      const peek = text(canvasElement, '.peekview-widget');
      for (const q of investigation.agent) expect(peek).toContain(q.tag);
      expect(peek).toContain(`snapshot ${forged.snapshot}`);
      expect(peek).toContain(`evidence: ${forged.evidence}`);
      expect(peek).toContain(`A  ${planted.path}`);
    });
  });
}

export const AgentAskedTwoMore: Story = {
  name: 'The agent asked two more questions',
  play: async ({ canvasElement, step }) => openThePeek(canvasElement, step),
};

export const IntoTheEvidence: Story = {
  name: 'From Peek into the evidence',
  play: async ({ canvasElement, step }) => {
    await openThePeek(canvasElement, step);

    await step("the planted file's line in the diff is squiggled: it shouldn't be there", async () => {
      await waitFor(() => expect(canvasElement.querySelector('.peekview-widget .squiggly-warning')).not.toBeNull());
    });

    await step('Go to Definition on it opens the planted file, at the forged read', async () => {
      // Peek opens with the cursor on the first changed file.
      key(canvasElement.querySelector('.peekview-widget .monaco-editor textarea, .peekview-widget .monaco-editor .native-edit-context'), 'F12', 123);
      await waitFor(() => expect(text(canvasElement, '[data-testid="investigation-path"]')).toContain(planted.path));
      await waitFor(() => expect(text(canvasElement, '.view-lines')).toContain('"matches_dummy_file": true'));
      expect(canvasElement.querySelector('.peekview-widget')).toBeNull();
    });

    await step("it's all new since the baseline, and the forged read is squiggled", async () => {
      await waitFor(() => expect(canvasElement.querySelectorAll('.investigation-added').length).toBeGreaterThan(0));
      await lens(canvasElement, 'not in the baseline');
      const input = canvasElement.querySelector('.monaco-editor textarea, .monaco-editor .native-edit-context');
      key(input, 'F8', 119);
      await waitFor(() => expect(text(canvasElement, '.marker-widget')).toContain(planted.finding!.message));
    });
  },
};
