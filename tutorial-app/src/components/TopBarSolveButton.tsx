import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import tutorialStore from 'tutorialkit:store';

/**
 * Solve/Reset for lessons that run with `editor: false`. TutorialKit only
 * draws its Solve button in the editor panel's header, so hiding the editor
 * used to hide Solve with it (see AcpTraceBridge's CIT-245/CIT-251 note).
 * Solve and Reset live on the store, not the editor: they swap the lesson's
 * files in the WebContainer and in the store's documents, which is all the
 * bridges read. This mirrors EditorSection's help action in
 * @tutorialkit/react's WorkspacePanel. On a lesson whose editor is visible
 * the editor's own button stays the only one.
 */
export default function TopBarSolveButton() {
  const ref = useStore(tutorialStore.ref);
  const loaded = useStore(tutorialStore.lessonFullyLoaded);
  const editorConfig = useStore(tutorialStore.editorConfig);
  const [action, setAction] = useState<'solve' | 'reset'>('solve');
  const [domLoaded, setDomLoaded] = useState(false);

  useEffect(() => setDomLoaded(true), []);

  // A new lesson starts unsolved, as TutorialKit's own button does.
  useEffect(() => setAction('solve'), [ref]);

  if (!domLoaded || editorConfig.visible || !tutorialStore.hasSolution()) {
    return null;
  }

  function onClick() {
    if (action === 'solve') {
      tutorialStore.solve();
      setAction('reset');
    } else {
      tutorialStore.reset();
      setAction('solve');
    }
  }

  return (
    <button
      className="flex items-center gap-1 text-sm text-tk-elements-topBar-iconButton-iconColor hover:text-tk-elements-topBar-iconButton-iconColorHover transition-theme bg-tk-elements-topBar-iconButton-backgroundColor hover:bg-tk-elements-topBar-iconButton-backgroundColorHover px-2 py-1 rounded-md disabled:opacity-50"
      disabled={!loaded}
      onClick={onClick}
    >
      <div className={`text-lg ${action === 'solve' ? 'i-ph-lightbulb-duotone' : 'i-ph-clock-counter-clockwise-duotone'}`} />
      {action === 'solve' ? 'Solve' : 'Reset'}
    </button>
  );
}
