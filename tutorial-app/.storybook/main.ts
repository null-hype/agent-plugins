import type { StorybookConfig } from '@storybook/react-vite';
import { otelWarmLogPage } from './otel-warm-log-page';

const config: StorybookConfig = {
	stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-mcp'],
	framework: '@storybook/react-vite',
	// The otel-warm-log template serves Monaco from /monaco/; do the same here.
	staticDirs: [{ from: '../node_modules/monaco-editor/min', to: '/monaco' }],
	async viteFinal(config) {
		return { ...config, plugins: [...(config.plugins ?? []), otelWarmLogPage()] };
	},
};

export default config;
