import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import completedFixture from '../../../.dagger/internal/devenv-base/toolbox/testdata/completed-claim-preregistration.json';
import type { ClaimPreregistration } from '../lib/claimPreregistration';
import ClaimReport, { type CompletedClaim } from '../components/ClaimReport';
const preregistration = completedFixture.preregistration;

// This is a display fixture, not the result of a real rerun. Use the same
// completed-claim boundary as the toolbox's local publisher proof.
const claim: CompletedClaim = {
  issue: { id: 'fixture-issue', identifier: 'DEMO-1', title: 'Preserve a claim across an observed world', description: 'Capture the inputs used to test the claim.\nRestore the exact snapshot and judge the registered prediction.\nKeep a disagreement inspectable after a later rerun.', state: { id: 'state-done', name: 'Done', type: 'completed' }, labels: { nodes: [{ name: 'public' }] } },
  delivery: 'fixture-delivery-2', check: 'registered-delivery', exit: 0,
  trace: 'https://dagger.cloud/', snapshot: { id: '1234567890abcdef'.repeat(4), url: 'https://github.com/null-hype/worlds', run_key: 'linear-demo-1' }, xeno: null,
};

const meta = { title: 'Tidelands/Claim report', component: ClaimReport, parameters: { layout: 'fullscreen' }, args: { claim } } satisfies Meta<typeof ClaimReport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Passing: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Preserve a claim across an observed world' })).toBeVisible();
    await expect(canvas.getByText('Passed')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'Trace ↗' })).toHaveAttribute('href', 'https://dagger.cloud/');
  },
};

export const FailingWithoutTrace: Story = {
  args: { claim: { ...claim, exit: 1, trace: '' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Failed')).toBeVisible();
    await expect(canvas.getByText('No trace')).toBeVisible();
  },
};

export const LongClaim: Story = {
  args: { claim: { ...claim, issue: { ...claim.issue, title: 'A long claim title that must remain readable on a narrow screen without hiding the verdict or its evidence' } } },
};

export const PreregistrationWithFindings: Story = { args: { claim: { ...claim, exit: 1, preregistration: preregistration as ClaimPreregistration } } };
