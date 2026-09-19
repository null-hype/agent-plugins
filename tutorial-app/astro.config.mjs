import { defineConfig } from 'astro/config';
import tutorialkit from '@tutorialkit/astro';

// tidelands.dev is the one public home of the tutorial (served by Netlify).
// Deploy previews override it via Netlify's URL so their links stay on the preview.
const isNetlify = process.env.NETLIFY === 'true';
const site = (isNetlify && process.env.CONTEXT !== 'production' && process.env.URL) || 'https://null-hype.tidelands.dev';

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
