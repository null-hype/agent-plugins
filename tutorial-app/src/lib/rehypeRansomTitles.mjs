import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import { clip, IONIC_T_PATHS } from './ransom.mjs';

const seal = () => ({
  type: 'element',
  tagName: 'svg',
  properties: {
    className: ['rn-mark'],
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  children: [
    { type: 'element', tagName: 'circle', properties: { cx: '24', cy: '24', r: '21.5' }, children: [] },
    ...IONIC_T_PATHS.map((d) => ({ type: 'element', tagName: 'path', properties: { d }, children: [] })),
  ],
});

/**
 * Sets every lesson h1 as ransom-note clippings, the same markup RansomNote
 * renders. The plain title stays in aria-label for screen readers.
 */
export default function rehypeRansomTitles() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'h1') return;
      const text = toString(node).trim();
      if (!text) return;
      node.properties = { ...node.properties, className: ['ransom-note'], ariaLabel: text };
      node.children = clip(text).map((letters) => ({
        type: 'element',
        tagName: 'span',
        properties: { className: ['rn-word'], ariaHidden: 'true' },
        children: letters.map(({ ch, seal: isSeal, className, tilt }) => ({
          type: 'element',
          tagName: 'span',
          properties: { className: ['rn-letter', className], style: `--rn-tilt: ${tilt}deg` },
          children: [isSeal ? seal() : { type: 'text', value: ch }],
        })),
      }));
    });
  };
}
