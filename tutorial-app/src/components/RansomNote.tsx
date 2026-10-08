import './RansomNote.css';

// Fixed tilts so a word looks the same on every render (no hydration drift).
const TILTS = [-2, 3, -1, 2, -4, 1, -3, 4, -2.5, 1.5];
const CLIPPINGS = 8;

// The circled Ionic T from public/logo.svg (CIT-332), stroked in currentColor
// so it takes each clipping's ink.
const IonicT = () => (
  <svg
    className="rn-mark"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="24" cy="24" r="21.5" />
    <path d="M13 14.8a1.6 1.6 0 0 1 0 3.2a3 3 0 0 1 0-6H35a3 3 0 0 1 0 6a1.6 1.6 0 0 1 0-3.2" />
    <path d="M17.5 15.4c2.8 0 3.7 1.4 3.7 4.2V31c0 5-2.1 8.6-5.7 8.6c3.6 0 6.5-0.9 8.5-3.1c2 2.2 4.9 3.1 8.5 3.1c-3.6 0-5.7-3.6-5.7-8.6V19.6c0-2.8 0.9-4.2 3.7-4.2" />
  </svg>
);

export interface RansomNoteProps {
  text: string;
  /** Font size of the largest clippings, in px. */
  size?: number;
  /** Shifts which clipping each letter starts on, for a different arrangement of the same word. */
  seed?: number;
  as?: 'h1' | 'h2' | 'span';
  /** Draw capital T as the circled Ionic T mark. */
  mark?: boolean;
}

export function RansomNote({ text, size = 48, seed = 0, as: Tag = 'span', mark = true }: RansomNoteProps) {
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
          {letters.map(({ ch, k }, i) =>
            mark && ch === 'T' ? (
              <span
                key={i}
                className="rn-letter rn-seal"
                style={{ '--rn-tilt': `${TILTS[k % TILTS.length]}deg` } as React.CSSProperties}
              >
                <IonicT />
              </span>
            ) : (
              <span
                key={i}
                className={`rn-letter rn-${k % CLIPPINGS}`}
                style={{ '--rn-tilt': `${TILTS[k % TILTS.length]}deg` } as React.CSSProperties}
              >
                {ch}
              </span>
            ),
          )}
        </span>
      ))}
    </Tag>
  );
}
