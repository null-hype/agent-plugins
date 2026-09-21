import { initialLessonState, reduceLesson, type LessonState, type LessonAction } from './followerMazeLog';
import { TIGHT_REASONS } from './followerMazeReasons';

/** Actual app input, consumed in Storybook and the WebContainer. Not a transcript. */
export interface WorkbenchSnapshot { lesson: LessonState; evidenceLine: number | null }
export const emptySnapshot = (): WorkbenchSnapshot => ({ lesson: { ...initialLessonState }, evidenceLine: null });
export function replay(actions: readonly LessonAction[]): WorkbenchSnapshot {
 return { lesson: actions.reduce(reduceLesson, { ...initialLessonState }), evidenceLine: null };
}
export const evaluatedFamily = () => replay([
 { type: 'write', text: TIGHT_REASONS }, { type: 'solve', model: 'arrival-order' },
 { type: 'transform' }, { type: 'evaluate' },
]);
export const serializeSnapshot = (snapshot: WorkbenchSnapshot) => JSON.stringify(snapshot, null, 2) + '\n';
