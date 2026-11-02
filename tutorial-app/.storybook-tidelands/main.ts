import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

// Compose the existing library without importing its stories into this build.
// Set this to a hosted Storybook URL when publishing the Tidelands Storybook.
const codespaceLibraryUrl = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `https://${process.env.CODESPACE_NAME}-7880.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : undefined;
const libraryUrl = process.env.AGENT_PLUGINS_STORYBOOK_URL || codespaceLibraryUrl || 'http://localhost:7880';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/tidelands-stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-mcp'],
  refs: {
    'agent-plugins': {
      title: 'Agent plugins',
      url: libraryUrl,
      expanded: false,
    },
  },
  async viteFinal(config) {
    return mergeConfig(config, { esbuild: { jsx: 'automatic' } });
  },
};

export default config;
