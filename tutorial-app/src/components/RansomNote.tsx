import './RansomNote.css';

// Fixed tilts so a word looks the same on every render (no hydration drift).
const TILTS = [-2, 3, -1, 2, -4, 1, -3, 4, -2.5, 1.5];
const CLIPPINGS = 8;

export interface RansomNoteProps {
  text: string;
  /** Font size of the largest clippings, in px. */
  size?: number;
  /** Shifts which clipping each letter starts on, for a different arrangement of the same word. */
  seed?: number;
  as?: 'h1' | 'h2' | 'span';
}

export function RansomNote({ text, size = 48, seed = 0, as: Tag = 'span' }: RansomNoteProps) {
  let n = 0;
  const words = text.split(' ').map((word) =>
    [...word].map((ch) => {
      const k = n++ + seed;
      return { ch, k };
    }),
  );
  return (
    <Tag className="ransom-note" aria-label={text} style={{ '--rn-size': `${size}px` } as React.CSSProperties}>
      {words.map((letters, w) => (
        // Each word stays on one line; only the gaps between words wrap.
        <span key={w} className="rn-word" aria-hidden>
          {letters.map(({ ch, k }, i) => (
            <span
              key={i}
              className={`rn-letter rn-${k % CLIPPINGS}`}
              style={{ '--rn-tilt': `${TILTS[k % TILTS.length]}deg` } as React.CSSProperties}
            >
              {ch}
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}
