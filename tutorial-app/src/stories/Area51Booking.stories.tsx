import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import Area51Booking from '../components/Area51Booking';

// CIT-235: each story below is one lesson step's *starting* state, read
// directly off the page by tests/area51-booking.spec.ts via
// iframe.html?id=<story id>&viewMode=story. No play function -- the
// Playwright @tutorial test is the only thing driving interaction; these
// stories exist to make each step's starting args reviewable on their own,
// not to demonstrate the flow themselves.

const meta = {
  title: 'Spikes/Area51 Booking',
  component: Area51Booking,
  parameters: { layout: 'centered' },
  argTypes: {
    reasonState: { control: 'radio', options: ['invalid', 'valid'] },
    decisionState: { control: 'radio', options: ['untyped', 'typed'] },
  },
} satisfies Meta<typeof Area51Booking>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Step1ReasonDoesNotCompile: Story = {
  args: { reasonState: 'invalid', decisionState: 'untyped' },
};

export const Step2DecisionIsTyped: Story = {
  args: { reasonState: 'valid', decisionState: 'untyped' },
};

export const Step3RunnableAppears: Story = {
  args: { reasonState: 'valid', decisionState: 'typed' },
};
