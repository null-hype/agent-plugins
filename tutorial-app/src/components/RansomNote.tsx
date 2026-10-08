import './RansomNote.css';
import { clip, IONIC_T_PATHS } from '../lib/ransom.mjs';

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
    {IONIC_T_PATHS.map((d) => (
      <path key={d} d={d} />
    ))}
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

// Lesson h1s get the same markup from src/lib/rehypeRansomTitles.mjs.
export function RansomNote({ text, size = 48, seed = 0, as: Tag = 'span', mark = true }: RansomNoteProps) {
  return (
    <Tag className="ransom-note" aria-label={text} style={{ '--rn-size': `${size}px` } as React.CSSProperties}>
      {clip(text, { seed, mark }).map((letters, w) => (
        // Each word stays on one line; only the gaps between words wrap.
        <span key={w} className="rn-word" aria-hidden>
          {letters.map(({ ch, seal, className, tilt }, i) => (
            <span
              key={i}
              className={`rn-letter ${className}`}
              style={{ '--rn-tilt': `${tilt}deg` } as React.CSSProperties}
            >
              {seal ? <IonicT /> : ch}
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}
