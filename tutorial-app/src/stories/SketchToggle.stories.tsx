import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import SketchToggle from '../components/SketchToggle';
import '../styles/sketch-frames.css';
import unsolvedSrc from '../../public/sketches/image-claims/workspace-unsolved.svg?url';
import solvedSrc from '../../public/sketches/image-claims/workspace-solved.svg?url';

// The Proton Drive lesson's workspace on a phone (part 7): two Excalidraw
// frames behind an Unsolved/Solved switch, standing in for the WebContainer.
// In the lesson it is mobile-only; here it is shown at any width.
const meta: Meta<typeof SketchToggle> = {
  title: 'Lessons/Sketch toggle',
  component: SketchToggle,
  args: {
    mobileOnly: false,
    unsolved: { src: unsolvedSrc, alt: 'Workspace before running the image checker' },
    solved: { src: solvedSrc, alt: 'Workspace after running the image checker' },
    caption: 'What the workspace would show, before and after running the checker.',
  },
};
export default meta;

export const ProtonDriveImageClaims: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const frame = (state: string) => canvasElement.querySelector(`.sketch-toggle-frame[data-state="${state}"]`)!;
    await expect(frame('unsolved')).toBeVisible();
    await expect(frame('solved')).not.toBeVisible();
    await userEvent.click(canvasElement.querySelector('input[value="solved"]')!.closest('label')!);
    await expect(frame('solved')).toBeVisible();
    await expect(frame('unsolved')).not.toBeVisible();
  },
};
