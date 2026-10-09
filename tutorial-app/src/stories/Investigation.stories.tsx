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
  "recovered_text": "\\"KR2S-CANARY-CIT294-0123456789abc\\"",
  "expected_text": "\\"KR2S-CANARY-CIT294-0123456789abc\\""
}
`;

// The check, as each pull request left it: the rule that decides whether an
// observation counts as a real read of the private file.
const reconcile = (lines: string[]) => [
  '/// Does an observation show a real read of the private file?',
  'module cit294.Reconcile',
  '',
  'import "Observation.pkl"',
  '',
  'function readPrivateFile(o: Observation.Observed, trace: String): Boolean =',
  ...lines,
  '',
].join('\n');
const matches = '  o.matches_dummy_file == true';
const sameText = '  && o.recovered_text == o.expected_text';
const traced = '  && trace.contains("openat(AT_FDCWD</app>, \\"/work/dummy-canary.txt\\"")';
const RULE = 6;

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
          verdicts: [
            { revision: '#117', passed: true, check: { path: 'inputs/Reconcile.pkl', rule: RULE, contents: reconcile([matches]),
              note: 'Takes the observation at its word: a forged one passes.' } },
            { revision: '#118', passed: true, check: { path: 'inputs/Reconcile.pkl', rule: RULE, contents: reconcile([matches, sameText]),
              note: 'Stronger, but still only reads the observation: a forged one that copies the text passes.' } },
            { revision: '#120', passed: false, check: { path: 'inputs/Reconcile.pkl', rule: RULE, contents: reconcile([matches, sameText, traced]),
              note: 'Requires the trace to show the read: a forged observation fails.' } },
          ],
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

/** Slice 2: from Peek into the planted file. */
async function intoTheEvidence(canvasElement: HTMLElement, step: (name: string, fn: () => Promise<void>) => Promise<void> | void) {
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
    key(input, 'Escape', 27);
  });
}

export const IntoTheEvidence: Story = {
  name: 'From Peek into the evidence',
  play: async ({ canvasElement, step }) => {
    await openThePeek(canvasElement, step);
    await intoTheEvidence(canvasElement, step);
  },
};

export const VerdictAcrossRevisions: Story = {
  name: 'The same evidence across #117, #118 and #120',
  play: async ({ canvasElement, step }) => {
    await openThePeek(canvasElement, step);
    await intoTheEvidence(canvasElement, step);

    await step('each revision of the check has a verdict on the forged read', async () => {
      for (const label of ['#117 ✗ passed', '#118 ✗ passed', '#120 ✓ failed']) await lens(canvasElement, label);
    });

    await step("#120's verdict opens its check, at the rule that caught the forgery", async () => {
      press(await lens(canvasElement, '#120 ✓ failed'));
      await waitFor(() => expect(text(canvasElement, '[data-testid="investigation-path"]')).toContain('#120  ›  inputs/Reconcile.pkl'));
      await waitFor(() => expect(text(canvasElement, '.view-lines')).toContain('trace.contains('));
      // The line #120 added since #118 is marked.
      await waitFor(() => expect(canvasElement.querySelectorAll('.investigation-added').length).toBe(1));
    });

    await step('Peek shows the check as #118 left it, without the trace', async () => {
      press(await lens(canvasElement, 'changed since #118 · Peek'));
      await waitFor(() => {
        const peek = text(canvasElement, '.peekview-widget');
        expect(peek).toContain('#118/inputs');
        expect(peek).toContain(sameText.trim());
        expect(peek).not.toContain('trace.contains(');
      });
    });
  },
};

// CIT-376: the same walk, starting where an archive arrived in Proton Drive. The
// archive's restic repository lives on Drive; its snapshot holds every finding
// since last month's archive.
const archiveQuestion = 'Does release-2026-10 still keep the private file private?';
const inDrive: Investigation = {
  drive: {
    folder: 'investigations',
    archives: [
      { name: 'release-2026-09.tar.gz', snapshot: '9f41c2d0', baseline: true },
      { name: 'release-2026-10.tar.gz', snapshot: '3c0f3a7e' },
    ],
  },
  vault: 'investigations',
  question: archiveQuestion,
  agent: [{
    tag: archiveQuestion,
    snapshot: '3c0f3a7e',
    evidence: 'Three findings: a forged read the check passed, a trace with the real read missing, and a crash.',
    changes: [...forged.changes, ...investigation.agent[1].changes],
  }],
};

export const ArchiveInDrive: Story = {
  name: 'An archive arrives in Proton Drive',
  args: { investigation: inDrive },
  play: async ({ canvasElement, step }) => {
    const input = () => canvasElement.querySelector('.monaco-editor textarea, .monaco-editor .native-edit-context');

    await step('your Drive folder lists last month\'s archive and the one you just uploaded', async () => {
      await waitFor(() => {
        for (const a of inDrive.drive!.archives) expect(text(canvasElement, '.view-lines')).toContain(a.name);
      });
      expect(text(canvasElement, '[data-testid="investigation-path"]')).toContain('Proton Drive  ›  investigations');
    });

    await step('a squiggle on the new archive: what changed since the last one', async () => {
      await waitFor(() => expect(canvasElement.querySelector('.squiggly-warning')).not.toBeNull());
      key(input(), 'F8', 119);
      await waitFor(() => expect(text(canvasElement, '.marker-widget')).toContain('3 findings since the last archive.'));
      key(input(), 'Escape', 27);
    });

    await step('opening it lists the archive like a tarball, against the previous one', async () => {
      press(await lens(canvasElement, '3 findings · open the archive'));
      await waitFor(() => expect(text(canvasElement, '[data-testid="investigation-path"]')).toContain('investigations  ›  release-2026-10.tar.gz'));
      await waitFor(() => expect(text(canvasElement, '.view-lines')).toContain(`A  ${planted.path}`));
      await waitFor(() => expect(canvasElement.querySelectorAll('.squiggly-warning').length).toBe(3));
    });

    await step('Go to Definition goes into the planted file, with its verdicts', async () => {
      // The archive opens with the cursor on its first change.
      key(input(), 'F12', 123);
      await waitFor(() => expect(text(canvasElement, '[data-testid="investigation-path"]')).toContain(`release-2026-10.tar.gz  ›  ${planted.path}`));
      await waitFor(() => expect(text(canvasElement, '.view-lines')).toContain('"matches_dummy_file": true'));
      await lens(canvasElement, '#120 ✓ failed');
    });
  },
};

/** The same Drive folder with no play function, to explore by hand. */
export const ArchiveInDriveExplore: Story = {
  name: 'An archive arrives in Proton Drive (explore)',
  args: { investigation: inDrive },
};
