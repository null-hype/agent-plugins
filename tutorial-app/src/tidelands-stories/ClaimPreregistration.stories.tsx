import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import ClaimPreregistration from '../components/ClaimPreregistration';
import completedFixture from '../../../.dagger/internal/devenv-base/toolbox/testdata/completed-claim-preregistration.json';
import type { ClaimPreregistration as Artifact } from '../lib/claimPreregistration';
import '../components/Tidelands.css';
const fixture = completedFixture.preregistration;

const artifact = fixture as Artifact;
const meta = { title: 'Tidelands/Preregistration', component: ClaimPreregistration, parameters: { layout: 'fullscreen' }, decorators: [(Story) => <div className="td-page"><main className="td-main td-section"><p className="td-eyebrow">Synthetic display fixture</p><Story /></main></div>], args: { artifact } } satisfies Meta<typeof ClaimPreregistration>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FindingsOnPredictions: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText(/1 finding\(s\) from this check/)).toBeVisible();
    if (!window.matchMedia('(min-width: 900px)').matches) {
      await expect(canvas.getByText(artifact.findings!.findings[0].message)).toBeVisible();
      return;
    }
    await waitFor(() => expect(canvasElement.querySelector('.squiggly-warning')).not.toBeNull(), { timeout: 20000 });
    const input = canvasElement.querySelector('.monaco-editor textarea, .monaco-editor .native-edit-context');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8', keyCode: 119, bubbles: true }));
    await waitFor(() => expect(canvasElement.querySelector('.marker-widget')?.textContent).toContain('Observed +0.24'));
  },
};
export const NoFindings: Story = { args: { artifact: { ...artifact, findings: { version: 1, findings: [] } } } };
export const FindingsUnavailable: Story = { args: { artifact: { ...artifact, findings: null } } };
export const SourceUnavailable: Story = { args: { artifact: null } };
export const StaleAndUnrelatedFindings: Story = {
  args: { artifact: { ...artifact, findings: { version: 1, findings: [
    { ...artifact.findings!.findings[0], sourceHash: 'sha256:other-source' },
    { ...artifact.findings!.findings[0], id: 'other-file', location: { file: 'delivery/work.spec.ts', line: 6, column: 5 }, message: 'This belongs to a test file, not to a prediction.' },
  ] } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/1 finding\(s\) refer to another file/)).toBeVisible();
    await expect(canvas.queryByText('This belongs to a test file, not to a prediction.')).not.toBeInTheDocument();
  },
};
