import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import { otelWarmLogPage } from './otel-warm-log-page';

const config: StorybookConfig = {
	stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-mcp'],
	framework: '@storybook/react-vite',
	// The otel-warm-log template serves Monaco from /monaco/; do the same here.
	staticDirs: [{ from: '../node_modules/monaco-editor/min', to: '/monaco' }],
	async viteFinal(config) {
		return mergeConfig(config, {
			plugins: [otelWarmLogPage()],
			// Astro compiles components with the automatic JSX runtime, so the
			// bridges don't `import React`; match that here.
			esbuild: { jsx: 'automatic' },
			resolve: {
				alias: {
					// The lesson bridges import TutorialKit's store; run them against a
					// stub seeded from the lesson's own files (see tutorialkit-store.ts).
					'tutorialkit:store': fileURLToPath(new URL('./tutorialkit-store.ts', import.meta.url)),
				},
			},
		});
	},
};

export default config;
