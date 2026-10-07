import { defineCollection, z } from 'astro:content';

// Drafts: a tutorial or part meta.md may list some of its `parts` or
// `chapters` again under `drafts`. TutorialKit drops anything missing from
// those order lists, routes and prev/next links included, so hiding a draft is
// just leaving it out. Drafts show in `astro dev` and on Netlify deploy
// previews; production and plain local builds hide them unless SHOW_DRAFTS=1.
const hideDrafts =
  !import.meta.env.DEV &&
  process.env.SHOW_DRAFTS !== '1' &&
  (process.env.CONTEXT ?? 'production') === 'production';

function applyDrafts(data: any) {
  if (!data || typeof data !== 'object' || !('drafts' in data)) return data;
  const { drafts, ...rest } = data;
  if (!hideDrafts) return rest;
  for (const key of ['parts', 'chapters'] as const) {
    if (Array.isArray(rest[key])) rest[key] = rest[key].filter((id: string) => !drafts.includes(id));
  }
  return rest;
}

// In Astro 4, TutorialKit doesn't use a 'loader' function.
// It uses standard content collections with a schema provided by the integration.
const tutorial = defineCollection({
  type: 'content',
  schema: z.any().transform(applyDrafts), // TutorialKit handles the validation internally
});

export const collections = { tutorial };
