import evidence from './generated/s1s2';
import type { ResticLessonEvidence } from './generated/restic_lesson_evidence.pkl';

export type {
  ResticLessonEvidence,
  ModelledSnapshot,
  ModelledDiff,
  FileDump,
  SnapshotRef,
  DiffEntry,
  FileTreeEntry,
} from './generated/restic_lesson_evidence.pkl';

/** Load the modelled claims without evaluating Pkl or reading capture files.
 * Each consumer gets its own copy, so editing a story cannot alter another.
 */
export function loadResticEvidence(): ResticLessonEvidence {
  return structuredClone(evidence);
}
