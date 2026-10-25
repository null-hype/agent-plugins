import { defineConfig } from '@playwright/test';
import { questions } from 'jev-lsp/config';

export default defineConfig(questions({
  contract: new URL('./questions.pcf', import.meta.url),
  answers: new URL('./answers.json', import.meta.url),
}));
