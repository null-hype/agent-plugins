import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import ClaimReport, { type CompletedClaim } from '../components/ClaimReport';

// This is a display fixture, not the result of a real rerun. Use the same
// completed-claim boundary as the toolbox's local publisher proof.
const claim: CompletedClaim = {
  issue: { id: 'fixture-issue', identifier: 'DEMO-1', title: 'Preserve a claim across an observed world', description: 'Capture the inputs used to test the claim.\nRestore the exact snapshot and judge the registered prediction.\nKeep a disagreement inspectable after a later rerun.', labels: { nodes: [{ name: 'public' }] } },
  delivery: 'fixture-delivery-2', check: 'registered-delivery', exit: 0,
  trace: 'https://dagger.cloud/', snapshot: { id: '1234567890abcdef'.repeat(4), url: 'https://github.com/null-hype/worlds', run_key: 'linear-demo-1' }, xeno: null,
};

const meta = { title: 'Tidelands/Claim report', component: ClaimReport, parameters: { layout: 'fullscreen' }, args: { claim } } satisfies Meta<typeof ClaimReport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PublicPassing: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Green · Passed')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Snapshot evidence ↗' })).toBeVisible();
  },
};

export const UnlistedFailingWithoutSnapshot: Story = {
  args: { claim: { ...claim, exit: 1, issue: { ...claim.issue, labels: { nodes: [] } }, snapshot: { id: '', run_key: 'linear-demo-1' } } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Red · Failed')).toBeVisible();
    await expect(canvas.getByText('Unavailable for this rerun')).toBeVisible();
    await expect(canvas.getByText(/Anyone with this link can view it/)).toBeVisible();
    await userEvent.click(canvas.getByText('Run details'));
    await expect(canvas.getByText('fixture-delivery-2')).toBeVisible();
  },
};

export const MissingEvidenceAndLongClaim: Story = {
  args: { claim: { ...claim, exit: 2, trace: '', issue: { ...claim.issue, title: 'A long claim title that must remain readable on a narrow screen without hiding the verdict or its evidence', description: '<script>This text is issue metadata, not executable HTML.</script>\n' + 'A-very-long-unbroken-issue-token-'.repeat(12) }, snapshot: { id: '', run_key: 'linear-demo-1' } } },
};

export const EmptyDescription: Story = { args: { claim: { ...claim, issue: { ...claim.issue, description: '' } } } };
