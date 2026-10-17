import type { Meta, StoryObj } from '@storybook/react-vite';
import * as monaco from 'monaco-editor';
import { expect, waitFor } from 'storybook/test';
import InvestigationVault from './InvestigationVault';
import { buildCodexReviewModel, type CodexReview } from '../lib/codexReviewModel';
import review from '../../evidence/codex-review-pr211-v1/review.json';
import syncScript from '../../evidence/codex-review-pr211-v1/codex-review-sync.sh?raw';

// The `codex review` that codex-review-sync.sh posted to PR #211, shown where
// a review belongs: on the reviewed lines, as editor diagnostics. Same
// transcript, second adapter -- the PR review is the first.

const record = review as CodexReview;
const model = buildCodexReviewModel(record, { '.dagger/internal/devenv-base/hk/codex-review-sync.sh': syncScript });

const meta = {
  title: 'Investigations/A Codex review',
  component: InvestigationVault,
  parameters: { layout: 'padded', docs: { description: { component: `Recorded: Codex session ${record.session}, reviewing ${record.git.branch} at ${record.git.commit_hash.slice(0, 7)} against main.` } } },
  args: { model, height: 640 },
} satisfies Meta<typeof InvestigationVault>;
export default meta;
type Story = StoryObj<typeof meta>;

const text = (root: Element | null, selector: string) =>
  (root?.querySelector(selector)?.textContent ?? '').replace(/ /g, ' ');
const key = (target: Element | null, name: string, keyCode: number) => {
  (target as HTMLElement | null)?.focus();
  target?.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, keyCode, bubbles: true, cancelable: true }));
};
// Markers outlive a disposed model (a remount, or the docs page), so ask only
// about the models this mount still has open.
const codexMarkers = () =>
  monaco.editor.getModels().filter((m) => m.uri.scheme === 'git')
    .flatMap((m) => monaco.editor.getModelMarkers({ owner: 'investigations', resource: m.uri }));

export const FindingsOnTheReviewedLines: Story = {
  name: 'Findings on the reviewed lines',
  play: async ({ canvasElement, step }) => {
    await step('the path bar carries the verdict', async () => {
      await waitFor(() => expect(text(canvasElement, '[data-testid="investigation-path"]')).toContain('patch is incorrect (0.95)'));
    });

    await step('each P2 finding is a warning on the lines Codex named', async () => {
      await waitFor(() => {
        const markers = codexMarkers();
        expect(markers.map((m) => [m.severity, m.startLineNumber, m.endLineNumber])).toEqual([
          [monaco.MarkerSeverity.Warning, 24, 25],
          [monaco.MarkerSeverity.Warning, 40, 42],
        ]);
      });
      await waitFor(() => expect(canvasElement.querySelector('.squiggly-warning')).not.toBeNull());
    });

    await step('a lens titles each finding; F8 opens its full text', async () => {
      await waitFor(() => expect(text(canvasElement, '.monaco-editor')).toContain('[P2] Fail explicitly when a captured review could not run'));
      key(canvasElement.querySelector('.monaco-editor textarea, .monaco-editor .native-edit-context'), 'F8', 119);
      await waitFor(() => expect(text(canvasElement, '.marker-widget')).toContain('A broken instrument fails the run.'));
    });
  },
};
