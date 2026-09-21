import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, testMatch: 'follower-maze-preview.spec.ts', outputDir: '../test-results/follower-maze-preview', use: { ...base.use, viewport: { width: 1600, height: 1500 } } });
