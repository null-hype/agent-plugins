import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import InvestigationVault, { type Investigation } from './InvestigationVault';

// CIT-365 / CIT-372: what a learner sees when an agent's questions meet the one
// they pre-registered. Made-up values on the private-file case; the snapshot
// model (CIT-371) supplies them later.
const investigation: Investigation = {
  vault: 'investigations',
  question: 'Can an upload read a private file?',
  agent: [
    {
      tag: 'Does the check fail when a read of the private file is forged?',
      snapshot: '32e5155e',
      evidence: 'Forging the read still left all 28 assertions passing.',
    },
    {
      tag: 'Can the check tell a real block from a generic crash?',
      snapshot: '3c0f3a7e',
      evidence: 'A generic crash made the check fail: 19 of 22 tests passed.',
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

const text = (root: HTMLElement, selector: string) =>
  (root.querySelector(selector)?.textContent ?? '').replace(/ /g, ' ');

// Monaco runs a CodeLens on mouseup, so a plain click() is not enough.
const press = (el: Element) => {
  for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
};

export const AgentAskedTwoMore: Story = {
  name: 'The agent asked two more questions',
  play: async ({ canvasElement, step }) => {
    const peekButton = () => within(canvasElement).findByRole('button', { name: /snapshots · Peek$/ }, { timeout: 5000 });

    await step('the vault shows the question you pre-registered', async () => {
      await waitFor(() => expect(text(canvasElement, '.view-lines')).toContain(investigation.question));
      // Monaco renders text before its debounced CodeLens command is ready.
      // Wait for a clickable command, not a cached label, before changing focus.
      await peekButton();
    });

    await step('a squiggle says the vault holds more questions than you declared', async () => {
      await waitFor(() => expect(canvasElement.querySelector('.squiggly-warning')).not.toBeNull());
      // Hovering the squiggle shows the same message; F8 opens it inline.
      const editor = canvasElement.querySelector<HTMLElement>('.monaco-editor textarea, .monaco-editor .native-edit-context');
      editor?.focus();
      editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8', keyCode: 119, bubbles: true }));
      await waitFor(() => expect(text(canvasElement, '.marker-widget')).toContain('Expected one question, got three.'));
      editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    });

    await step("Peek lists the agent's questions, from their snapshots", async () => {
      const lens = await peekButton();
      press(lens);
      // The list names each snapshot by its tag; the first one opens with its evidence.
      const [first] = investigation.agent;
      await waitFor(() => {
        const peek = text(canvasElement, '.peekview-widget');
        for (const q of investigation.agent) expect(peek).toContain(q.tag);
        expect(peek).toContain(`snapshot: ${first.snapshot}`);
        expect(peek).toContain(`evidence: ${first.evidence}`);
      });
    });
  },
};
