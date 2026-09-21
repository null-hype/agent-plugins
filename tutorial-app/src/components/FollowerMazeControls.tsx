import { useStore } from '@nanostores/react';
import tutorialStore from 'tutorialkit:store';

/** Preview-only lessons still use TutorialKit's own Reset and Solve operations. */
export default function FollowerMazeControls() {
 const ready = useStore(tutorialStore.lessonFullyLoaded);
 return <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
  <button disabled={!ready} onClick={() => tutorialStore.reset()}>Reset interaction</button>
  <button disabled={!ready} onClick={() => tutorialStore.solve()}>Show completed interaction</button>
 </div>;
}
