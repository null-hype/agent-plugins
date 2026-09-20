import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import IntegrationCheck from '../components/IntegrationCheck';
import { replay } from '../lib/integrationSession';

// Synthetic fixture (CIT-176): every state below is built by replaying real
// actions through the fixture evaluator, never by hand-writing a verdict.
const meta = {
	title: 'Governance/Integration Check',
	component: IntegrationCheck,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof IntegrationCheck>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CandidatesPassCombinedPending: Story = {
	play: async ({ canvas }) => {
		await expect(canvas.getAllByText('Passed')).toHaveLength(2);
		await expect(canvas.getByText('Not yet evaluated')).toBeVisible();
		await expect(canvas.getByText('Not approved')).toBeVisible();
	},
};

export const CleanMergeCombinedFailure: Story = {
	args: { initialState: replay({ type: 'evaluate' }) },
	play: async ({ canvas }) => {
		await expect(canvas.getByText('Failed', { selector: '.ic-failed' })).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Inspect disagreement' })).toHaveAttribute('aria-expanded', 'false');
	},
};

export const FailureExpanded: Story = {
	args: { initialState: replay({ type: 'evaluate' }), initialInspect: true },
	play: async ({ canvas }) => {
		await expect(canvas.getByText('Contributions relative to base', { exact: false })).toBeVisible();
		await expect(canvas.getByText('Governing rule')).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Apply repair (revises candidate B)' })).toBeVisible();
	},
};

export const RevisedCandidateEvaluationStale: Story = {
	args: { initialState: replay({ type: 'evaluate' }, { type: 'applyRepair' }) },
	play: async ({ canvas }) => {
		await expect(canvas.getByText('Stale: inputs changed')).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Re-evaluate integration' })).toBeVisible();
	},
};

export const StaleApprovalAfterRevision: Story = {
	args: {
		initialState: {
			...replay({ type: 'applyRepair' }, { type: 'evaluate' }, { type: 'approve' }),
			repairApplied: false, // inputs changed after approval
		},
	},
	play: async ({ canvas }) => {
		await expect(canvas.getByText('Approval stale')).toBeVisible();
	},
};

export const RevisedIntegrationAwaitingApproval: Story = {
	args: { initialState: replay({ type: 'evaluate' }, { type: 'applyRepair' }, { type: 'evaluate' }) },
	play: async ({ canvas }) => {
		await expect(canvas.getByText('Not approved')).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Approve landing (simulated)' })).toBeVisible();
	},
};

// Full interaction, keyboard only: evaluate -> inspect -> repair -> re-evaluate -> approve.
export const FullFlowKeyboard: Story = {
	play: async ({ canvas, userEvent }) => {
		const evaluate = canvas.getByRole('button', { name: 'Evaluate integration' });
		evaluate.focus();
		await userEvent.keyboard('{Enter}');
		const inspect = await canvas.findByRole('button', { name: 'Inspect disagreement' });
		inspect.focus();
		await userEvent.keyboard('{Enter}');
		await expect(inspect).toHaveAttribute('aria-expanded', 'true');
		const repair = canvas.getByRole('button', { name: 'Apply repair (revises candidate B)' });
		repair.focus();
		await userEvent.keyboard('{Enter}');
		await expect(await canvas.findByText('Stale: inputs changed')).toBeVisible();
		const re = canvas.getByRole('button', { name: 'Re-evaluate integration' });
		re.focus();
		await userEvent.keyboard('{Enter}');
		await expect(await canvas.findByText('Checks passed for', { exact: false })).toBeVisible();
		await expect(canvas.getByText('Not approved')).toBeVisible();
		const approve = canvas.getByRole('button', { name: 'Approve landing (simulated)' });
		approve.focus();
		await userEvent.keyboard('{Enter}');
		await expect(await canvas.findByText('Nothing was landed.', { exact: false })).toBeVisible();
	},
};
