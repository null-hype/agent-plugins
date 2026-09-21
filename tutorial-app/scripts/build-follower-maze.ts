import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { otelWarmLogPage } from '../.storybook/otel-warm-log-page';
export default defineConfig({
 configFile: false,
 root: fileURLToPath(new URL('../src/follower-maze-app', import.meta.url)),
 plugins: [otelWarmLogPage()],
 esbuild: { jsx: 'automatic' },
 build: { outDir: '../templates/follower-maze/public', emptyOutDir: true },
});
