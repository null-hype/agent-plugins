import { useId } from 'react';
import { IONIC_T_PATHS } from '../lib/ransom.mjs';
import './HoloSticker.css';

export interface HoloStickerProps {
  /** Rendered width and height, in px. */
  size?: number;
  /** Degrees of tilt, as if slapped on by hand. */
  tilt?: number;
}

// The CIT-332 Ionic T as a die-cut holographic sticker, after the foil
// illustrations in the TypeSafe cards: iridescent fill, thick ink outline,
// a white die-cut margin and a sheen band that sweeps across on hover.
export function HoloSticker({ size = 160, tilt = -8 }: HoloStickerProps) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className="holo-sticker"
      width={size}
      height={size}
      viewBox="-6 -6 60 60"
      role="img"
      aria-label="Tidelands"
      style={{ '--hs-tilt': `${tilt}deg` } as React.CSSProperties}
    >
      <defs>
        <linearGradient id={`${id}-foil`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9ad5" />
          <stop offset="0.2" stopColor="#c7a6ff" />
          <stop offset="0.4" stopColor="#8fd3ff" />
          <stop offset="0.55" stopColor="#9dffcf" />
          <stop offset="0.72" stopColor="#fff59a" />
          <stop offset="0.88" stopColor="#ffb38a" />
          <stop offset="1" stopColor="#ff9ad5" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-disc`}>
          <circle cx="24" cy="24" r="21.5" />
        </clipPath>
      </defs>
      {/* Die-cut margin, then the ink outline around it. */}
      <circle cx="24" cy="24" r="26.5" fill="#fff" stroke="#000" strokeWidth="1.6" />
      <circle className="hs-foil" cx="24" cy="24" r="21.5" fill={`url(#${id}-foil)`} stroke="#000" strokeWidth="2.6" />
      <g clipPath={`url(#${id}-disc)`}>
        <rect className="hs-sheen" x="-30" y="-10" width="16" height="70" fill={`url(#${id}-sheen)`} />
      </g>
      <g fill="none" stroke="#000" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        {IONIC_T_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
