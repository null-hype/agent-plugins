import { defineCollection, z } from 'astro:content';

// In Astro 4, TutorialKit doesn't use a 'loader' function.
// It uses standard content collections with a schema provided by the integration.
const tutorial = defineCollection({
  type: 'content',
  schema: z.any(), // TutorialKit handles the validation internally
});

export const collections = { tutorial };
