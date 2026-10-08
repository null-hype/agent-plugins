import { useId, useRef } from "react";
import { IONIC_T_PATHS } from "../lib/ransom.mjs";
import "./HoloSticker.css";

export interface HoloStickerProps {
  /** Rendered width and height, in px. */
  size?: number;
  /** Degrees of tilt, as if slapped on by hand. */
  tilt?: number;
}

// The CIT-332 Ionic T as a die-cut holographic sticker, after the foil
// illustrations in the TypeSafe cards: iridescent fill, thick ink outline and
// a white die-cut margin. At rest the foil drifts and a sheen sweeps across
// now and then; under the pointer the sticker tilts toward it, the foil
// slides with the angle and a glare spot follows (see HoloSticker.css).
export function HoloSticker({ size = 160, tilt = -8 }: HoloStickerProps) {
  const id = useId().replace(/:/g, "");
  const foil = useRef<SVGLinearGradientElement>(null);

  // Pointer position over the sticker, 0..1 on each axis, drives the tilt and
  // glare through CSS variables and the foil through its gradientTransform.
  const move = (e: React.PointerEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const s = e.currentTarget.style;
    s.setProperty("--hs-x", x.toFixed(3));
    s.setProperty("--hs-y", y.toFixed(3));
    foil.current?.setAttribute(
      "gradientTransform",
      `translate(${((x + y) * 0.6 - 0.6).toFixed(3)} 0)`,
    );
  };
  const leave = () => foil.current?.removeAttribute("gradientTransform");

  // The span carries the 3D tilt; the svg keeps its flat drop shadow, since a
  // filter inside a 3D-transformed layer rasterizes coarsely in Chrome.
  return (
    <span
      className="holo-sticker"
      style={{ "--hs-tilt": `${tilt}deg` } as React.CSSProperties}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <svg
        width={size}
        height={size}
        viewBox="-6 -6 60 60"
        role="img"
        aria-label="Tidelands"
      >
        <defs>
          <linearGradient
            ref={foil}
            id={`${id}-foil`}
            x1="0"
            y1="0"
            x2="0.6"
            y2="0.6"
            spreadMethod="reflect"
          >
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
          <radialGradient id={`${id}-glare`}>
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="0.35" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}-disc`}>
            <circle cx="24" cy="24" r="21.5" />
          </clipPath>
        </defs>
        {/* Die-cut margin, then the ink outline around it. */}
        <circle
          cx="24"
          cy="24"
          r="26.5"
          fill="#fff"
          stroke="#000"
          strokeWidth="1.6"
        />
        <circle
          className="hs-foil"
          cx="24"
          cy="24"
          r="21.5"
          fill={`url(#${id}-foil)`}
          stroke="#000"
          strokeWidth="2.6"
        />
        <g clipPath={`url(#${id}-disc)`}>
          <rect
            className="hs-sheen"
            x="-30"
            y="-10"
            width="16"
            height="70"
            fill={`url(#${id}-sheen)`}
          />
          <circle
            className="hs-glare"
            cx="0"
            cy="0"
            r="16"
            fill={`url(#${id}-glare)`}
          />
        </g>
        <g
          fill="none"
          stroke="#000"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {IONIC_T_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
    </span>
  );
}
