import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within, waitFor } from 'storybook/test';
import GrammarAsProtocolMockup from '../components/GrammarAsProtocolMockup';

const meta = {
	title: 'Mockups/Grammar As Protocol',
	component: GrammarAsProtocolMockup,
	parameters: {
		layout: 'centered',
	},
} satisfies Meta<typeof GrammarAsProtocolMockup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Baseline: Story = {
	render: () => <GrammarAsProtocolMockup />,
};

export const UserFlowWalkthrough: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const nextButton = canvas.getByText('Next State');

		// 1. Start at Baseline
		await waitFor(() => canvas.getByText('sentence.de'));

		// 2. Move to Diagnostic
		await userEvent.click(nextButton);
		await waitFor(() => {
			const token = canvasElement.querySelector('.token');
			if (!token) throw new Error('Token not found');
			if (!token.classList.contains('error')) throw new Error('Token should have error class');
		});

		// 3. Move to Hover
		await userEvent.click(nextButton);
		await waitFor(() => canvas.getByText('Grammar (Dative Case)'));

		// 4. Move to Peek
		await userEvent.click(nextButton);
		await waitFor(() => canvas.getByText('rule dative_verbs {'));

		// 5. Move to Quick Fix
		await userEvent.click(nextButton);
		await waitFor(() => canvasElement.querySelector('.lightbulb'));

		// 6. Apply Fix
		const lightbulb = canvasElement.querySelector('.lightbulb');
		if (lightbulb) {
			await userEvent.click(lightbulb as HTMLElement);
		}
		await waitFor(() => canvas.getByText('meinem'));
	},
};
