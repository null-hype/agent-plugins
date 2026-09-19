import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import GrammarTutor from '../components/GrammarTutor';

const meta = {
	title: 'Lessons/Grammar Tutor',
	component: GrammarTutor,
	parameters: {
		layout: 'centered',
	},
} satisfies Meta<typeof GrammarTutor>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DativeLesson: Story = {
	render: () => <GrammarTutor />,
};
