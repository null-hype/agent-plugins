import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

// A second Storybook that holds only the stories under review in the open
// CIT-368 PR stack, so they aren't buried among the full catalogue in
// `.storybook/`. Add a story file to `stories` when a stack PR introduces it.
//
// Unlike the main config this skips `replay:generate` and the TutorialKit
// store alias: these stories import neither the generated lesson JSON nor the
// lesson bridges. A story that does belongs in the main Storybook.
const config: StorybookConfig = {
	stories: ['../src/stories/Investigation.stories.tsx'],
	addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
	framework: '@storybook/react-vite',
	async viteFinal(config) {
		return mergeConfig(config, {
			esbuild: { jsx: 'automatic' },
		});
	},
};

export default config;
