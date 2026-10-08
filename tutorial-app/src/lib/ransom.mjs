// Shared by RansomNote.tsx and rehypeRansomTitles.mjs so a title renders the
// same clippings whether it comes from a component or from lesson markdown.

// Fixed tilts so a word looks the same on every render (no hydration drift).
export const TILTS = [-2, 3, -1, 2, -4, 1, -3, 4, -2.5, 1.5];
export const CLIPPINGS = 8;

// The circled Ionic T from public/logo.svg (CIT-332).
export const IONIC_T_PATHS = [
  'M13 14.8a1.6 1.6 0 0 1 0 3.2a3 3 0 0 1 0-6H35a3 3 0 0 1 0 6a1.6 1.6 0 0 1 0-3.2',
  'M17.5 15.4c2.8 0 3.7 1.4 3.7 4.2V31c0 5-2.1 8.6-5.7 8.6c3.6 0 6.5-0.9 8.5-3.1c2 2.2 4.9 3.1 8.5 3.1c-3.6 0-5.7-3.6-5.7-8.6V19.6c0-2.8 0.9-4.2 3.7-4.2',
];

/**
 * Splits text into words of clippings. Each letter gets a clipping class and a
 * tilt; with `mark`, a capital T becomes the Ionic T seal.
 */
export function clip(text, { seed = 0, mark = true } = {}) {
  let n = 0;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      [...word].map((ch) => {
        const k = n++ + seed;
        return {
          ch,
          seal: mark && ch === 'T',
          className: mark && ch === 'T' ? 'rn-seal' : `rn-${k % CLIPPINGS}`,
          tilt: TILTS[k % TILTS.length],
        };
      }),
    );
}
