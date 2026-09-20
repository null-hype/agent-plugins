import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import PrecogBoard from '../components/PrecogBoard';

/**
 * Pre-cog Board (CIT-199) Storybook Stories
 * 
 * Implements the six play() steps from the Excalidraw storyboard:
 * 1 · render: empty board (0 sealed · 0 done · 0 stale · 0 alarms)
 * 2 · predict: typed Pkl, sealed (2 sealed · 0 done · 0 stale · 0 alarms)
 * 3 · log: L1 reason + access match (1 sealed · 1 done · 0 stale · 0 alarms)
 * 4 · unpredicted log: alarm row (1 sealed · 1 done · 0 stale · 1 alarm)
 * 5 · run ends: L2 stale (0 sealed · 1 done · 1 stale · 1 alarm)
 * 6 · hover alarm: pick a repair (same target as L2, different purpose -> change world/model/axiom)
 */
const meta = {
	title: 'Governance/Precog Board',
	component: PrecogBoard,
	parameters: {
		layout: 'centered',
	},
} satisfies Meta<typeof PrecogBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

// 1 · render: empty board
export const Step1_RenderEmptyBoard: Story = {
	args: { initialStep: '1_render' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('0 sealed · 0 done · 0 stale · 0 alarms')).toBeVisible();
		await expect(canvas.getByText('// type a prediction')).toBeVisible();
		await expect(canvas.getByText('monitor idle', { exact: false })).toBeVisible();
	},
};

// 2 · predict: typed Pkl, sealed
export const Step2_PredictSealed: Story = {
	args: { initialStep: '2_predict' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('2 sealed · 0 done · 0 stale · 0 alarms')).toBeVisible();
		await expect(canvas.getByText('ci/deploy-key')).toBeVisible();
		await expect(canvas.getByText('prod/db-admin')).toBeVisible();
		await expect(canvas.getAllByText('sealed')).toHaveLength(2);
		await expect(canvas.getByText('monitor idle', { exact: false })).toBeVisible();
	},
};

// 3 · log: L1 reason + access match -> DONE
export const Step3_FirstLogDone: Story = {
	args: { initialStep: '3_log' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('1 sealed · 1 done · 0 stale · 0 alarms')).toBeVisible();
		await expect(canvas.getByText('DONE')).toBeVisible();
		await expect(canvas.getByText('deploy staging')).toBeVisible();
	},
};

// 4 · unpredicted log: alarm row with near-miss divergence
export const Step4_UnpredictedLogAlarm: Story = {
	args: { initialStep: '4_unpredicted_log' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('1 sealed · 1 done · 0 stale · 1 alarm')).toBeVisible();
		await expect(canvas.getByText('NOT PREDICTED')).toBeVisible();
		await expect(canvas.getByText('rotate token')).toBeVisible();
	},
};

// 5 · run ends: L2 stale
export const Step5_RunEndsStale: Story = {
	args: { initialStep: '5_run_end' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('0 sealed · 1 done · 1 stale · 1 alarm')).toBeVisible();
		await expect(canvas.getByText('DONE')).toBeVisible();
		await expect(canvas.getByText('STALE')).toBeVisible();
		await expect(canvas.getByText('NOT PREDICTED')).toBeVisible();
		await expect(canvas.getByText('-- run ended --')).toBeVisible();
	},
};

// 6 · hover alarm: pick a repair
export const Step6_HoverAlarmPickRepair: Story = {
	args: { initialStep: '6_hover_alarm' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText('same target as L2, different purpose')).toBeVisible();
		const changeWorld = canvas.getByRole('button', { name: 'change world' });
		const changeModel = canvas.getByRole('button', { name: 'change model' });
		const changeAxiom = canvas.getByRole('button', { name: 'change axiom' });

		await expect(changeWorld).toBeVisible();
		await expect(changeModel).toBeVisible();
		await expect(changeAxiom).toBeVisible();

		// Interactive selection: supervisor picks "change world"
		await userEvent.click(changeWorld);
		await expect(await canvas.findByText('Selected repair:')).toBeVisible();
		await expect(canvas.getByText('change world', { selector: 'strong' })).toBeVisible();
	},
};

// Full interactive walkthrough cycling through all 6 states via the "Next State" button
export const FullWalkthrough: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const nextBtn = canvas.getByRole('button', { name: 'Next State →' });

		// Step 1: Render empty
		await expect(canvas.getByText('0 sealed · 0 done · 0 stale · 0 alarms')).toBeVisible();

		// Step 2: Predict sealed
		await userEvent.click(nextBtn);
		await expect(canvas.getByText('2 sealed · 0 done · 0 stale · 0 alarms')).toBeVisible();

		// Step 3: First log -> DONE
		await userEvent.click(nextBtn);
		await expect(canvas.getByText('1 sealed · 1 done · 0 stale · 0 alarms')).toBeVisible();
		await expect(canvas.getByText('DONE')).toBeVisible();

		// Step 4: Unpredicted log -> Alarm
		await userEvent.click(nextBtn);
		await expect(canvas.getByText('1 sealed · 1 done · 0 stale · 1 alarm')).toBeVisible();
		await expect(canvas.getByText('NOT PREDICTED')).toBeVisible();

		// Step 5: Run end -> Stale
		await userEvent.click(nextBtn);
		await expect(canvas.getByText('0 sealed · 1 done · 1 stale · 1 alarm')).toBeVisible();
		await expect(canvas.getByText('STALE')).toBeVisible();

		// Step 6: Hover alarm -> Repair
		await userEvent.click(nextBtn);
		await expect(canvas.getByText('same target as L2, different purpose')).toBeVisible();
		const changeModel = canvas.getByRole('button', { name: 'change model' });
		await userEvent.click(changeModel);
		await expect(canvas.getByText('change model', { selector: 'strong' })).toBeVisible();
	},
};
