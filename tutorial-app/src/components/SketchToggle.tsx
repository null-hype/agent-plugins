import { useId } from 'react';

type Frame = { src: string; alt: string };

/**
 * Two sketch frames of a lesson's workspace, unsolved and solved, behind a
 * toggle (CIT-407). On a phone, where TutorialKit drops the WebContainer
 * below its `sm` breakpoint, this stands in for Solve/Reset: the frames show
 * what the workspace would show before and after.
 *
 * The toggle is two radios and CSS (sketch-frames.css), so it works in a
 * lesson rendered with no client directive and in Storybook without
 * TutorialKit's store. Each frame links to its own SVG so a tap opens it full
 * size. The frames are Excalidraw drawings, rendered by render-sketches.ts.
 */
export default function SketchToggle({ unsolved, solved, caption, mobileOnly = true }: {
  unsolved: Frame;
  solved: Frame;
  caption?: string;
  mobileOnly?: boolean;
}) {
  const name = `sketch-toggle${useId()}`;
  return (
    <figure className="sketch-frames sketch-toggle" data-mobile-only={mobileOnly ? '' : undefined}>
      <div className="sketch-toggle-switch" role="radiogroup" aria-label="Workspace">
        <label><input type="radio" name={name} value="unsolved" defaultChecked />Before check</label>
        <label><input type="radio" name={name} value="solved" />Recorded result</label>
      </div>
      <a className="sketch-toggle-frame" data-state="unsolved" href={unsolved.src}><img src={unsolved.src} alt={unsolved.alt} /></a>
      <a className="sketch-toggle-frame" data-state="solved" href={solved.src}><img src={solved.src} alt={solved.alt} /></a>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
