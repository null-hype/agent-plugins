import type { AcpPin } from '../acpTraceProtocol';
import type { CaptureKey, FrameKey } from './identity';

/**
 * The four questions of the history. A question is identified by the frame
 * that poses it (`ReplaySelection { kind: 'question', frameId }`), so
 * selecting Q1 means selecting frame `r1-review`.
 *
 * Wording is kept in two labelled parts because they have different standing:
 *
 *   - `recorded` is verbatim text from a retrieved source: the CIT-294 issue
 *     for Q0, the reviewer's own sentence for Q1 and Q2, and for Q3 a sentence
 *     from the cc23e89 commit message, because review 3's own text could not be
 *     retrieved (`secondHand`).
 *   - `framing` is the one-line question CIT-305 (section 7) wrote for the
 *     transition table. It is an editorial reading of the recorded text, shown
 *     as such, never as something a reviewer said.
 */
export type QuestionId = 'Q0' | 'Q1' | 'Q2' | 'Q3';

export type Question = {
  id: QuestionId;
  frame: FrameKey;
  pin: string;
  label: string;
  framing: string | null;
  /** Verbatim from `source` (whitespace may differ where the source wraps lines). */
  recorded: string;
  source: CaptureKey;
  secondHand: boolean;
};

export const Q0_CRITERIA = [
  'Run one pinned Rails/libvips/libmatio/HDF5 configuration against three inputs/arms:',
  '',
  '1. **Unblocked MATLAB/HDF5 canary:** a test-owned dummy file is read through the actual Rails representation/variant path, and its bytes are recoverable from the output produced by the real loader.',
  '2. **Blocked MATLAB/HDF5 canary:** the same input/configuration with untrusted loaders blocked refuses the path; retain loader-blocking/refusal evidence and show no dummy-file read/disclosure. A generic crash alone is insufficient.',
  '3. **Ordinary PNG control:** normal image processing continues to work, including under the blocking configuration.',
].join('\n');

export const REVIEW_HISTORY_QUESTIONS: Readonly<Record<QuestionId, Question>> = {
  Q0: {
    id: 'Q0',
    frame: 'q0',
    pin: 'q0',
    label: 'Q0 · original question and criteria — historical issue text (CIT-294, created 2026-10-03T22:56:40Z, text as retrieved 2026-10-04), not a sealed declaration: nothing was registered before this run',
    framing: null,
    recorded: Q0_CRITERIA,
    source: 'q0Description',
    secondHand: false,
  },
  Q1: {
    id: 'Q1',
    frame: 'r1',
    pin: 'q1',
    label: 'Q1 · question raised by review 1 of #117',
    framing: 'can the checker certify contradictory or incomplete evidence?',
    recorded: 'its authoritative checks can certify contradictory or incomplete evidence',
    source: 'review1',
    secondHand: false,
  },
  Q2: {
    id: 'Q2',
    frame: 'r2',
    pin: 'q2',
    label: 'Q2 · question raised by review 2 of #118',
    framing: 'did #118 close all five mutations?',
    recorded: "The PR's claim that all five exact mutations are fixed is therefore inaccurate.",
    source: 'review2',
    secondHand: false,
  },
  Q3: {
    id: 'Q3',
    frame: 'r3',
    pin: 'q3',
    label: 'Q3 · question raised by review 3 of #120 — second-hand account: the original review text could not be retrieved',
    framing: 'does the trace check require a parsed, successful open of the exact path, and any evidence at all for a zero-count arm?',
    recorded: 'the independent-read check still only did a bare substring match on the retained trace text, and nothing required valid trace evidence to exist for an arm whose expected open-count was already zero',
    source: 'commitS4',
    secondHand: true,
  },
};

export const QUESTION_ORDER: readonly QuestionId[] = ['Q0', 'Q1', 'Q2', 'Q3'];

/** The pin a question's frame carries. Q0 pins the criteria excerpt itself; the others pin framing and recorded wording side by side. */
export function questionPin(question: Question): AcpPin {
  if (question.id === 'Q0') return { id: question.pin, label: question.label, text: question.recorded };
  const wording = question.secondHand ? 'Second-hand wording (cc23e89 commit message)' : 'Recorded wording';
  return {
    id: question.pin,
    label: question.label,
    text: `Framing (CIT-305): ${question.framing}\n${wording}: “${question.recorded}”`,
  };
}
