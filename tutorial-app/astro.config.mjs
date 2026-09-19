import { defineConfig } from 'astro/config';
import tutorialkit from '@tutorialkit/astro';

const isNetlify = process.env.NETLIFY === 'true';
const site = isNetlify ? process.env.URL || 'https://null-hype-tutorial-app.netlify.app' : 'https://null-hype.github.io';

export default defineConfig({
  site,
  base: '/',
  integrations: [
    tutorialkit({
      components: {
        HeadTags: './src/components/HeadTags.astro',
      },
    }),
  ]
});
