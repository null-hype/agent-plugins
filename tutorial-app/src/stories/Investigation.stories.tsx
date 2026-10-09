import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import InvestigationVault, { type Investigation } from './InvestigationVault';
import { forged, inDrive, investigation, planted, sameText } from './investigationFixtures';
import { driveEntries, formatSize, type ProtonDriveNode } from '../lib/protonDriveListing';
import snapshotsListing from './fixtures/protondrive/list-json-restic-snapshots.json';

// CIT-365: what a learner sees when an agent's questions meet the one they
// pre-registered, and how they walk into the evidence. The investigation data
// lives in `investigationFixtures.ts` (shared with the module's vitest).

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

// CIT-386: the Drive pane from a real listing, not a hand-written folder.
// CIT-378's live round trip listed its restic repository's snapshots with
// `proton-drive filesystem list --json` (see fixtures/protondrive/README.md).
// A restic snapshot file is named by its snapshot ID. No agent has asked
// anything of this repository yet, so the pane has no findings.
const snapshotsFolder = 'my-files/protondrive-scenario-20261009T202201Z-4de6cd3f/restic-repo/snapshots';
const [realSnapshot] = driveEntries(snapshotsListing as ProtonDriveNode[]);
const fromListing: Investigation = {
  drive: {
    folder: snapshotsFolder,
    archives: driveEntries(snapshotsListing as ProtonDriveNode[]).map((e) => ({
      name: e.name,
      snapshot: e.name.slice(0, 8),
      // `2026-10-09 20:23 UTC`, as Drive's own listing would date it.
      detail: `${e.size === undefined ? e.type : formatSize(e.size)} · ${e.modified.slice(0, 16).replace('T', ' ')} UTC`,
    })),
  },
  vault: 'investigations',
  question: inDrive.question,
  agent: [],
};

export const RealDriveListing: Story = {
  name: 'The Drive pane from a real filesystem list',
  args: { investigation: fromListing },
  play: async ({ canvasElement, step }) => {
    await step('the path bar is the restic repository\'s snapshots folder on Drive', async () => {
      await waitFor(() => expect(text(canvasElement, '[data-testid="investigation-path"]')).toMatch(/^Proton Drive {2}› {2}.*\/restic-repo\/snapshots$/));
    });

    await step('the pane lists the real snapshot, with the size the CLI reported', async () => {
      await waitFor(() => {
        const lines = text(canvasElement, '.view-lines');
        expect(lines).toContain(realSnapshot.name);
        expect(lines).toContain('411 B · 2026-10-09 20:23 UTC');
      });
    });
  },
};
