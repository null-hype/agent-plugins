import React from 'react';
import type { WitnessModelId } from './followerMaze';
import type { Board, Category } from './followerMazeLog';

/**
 * CIT-226: the two remaining pieces of *board state* from the CIT-203
 * storyboard. Like FollowerMazeStatus, they show what the board is in and what
 * the learner can do next, and never a diagnostic: no fm-* code, no message,
 * no evidence. Those stay in the warm log's marker, hover, lens and widget.
 */

export const OUTCOME_STYLE: Record<Category | 'unevaluated', { background: string; color: string }> = {
  unevaluated: { background: '#f6f3ea', color: '#5f5b4f' },
  pass: { background: '#dff3e4', color: '#1a7f37' },
  missing: { background: '#fbe3e1', color: '#b3261e' },
  forbidden: { background: '#fdebd0', color: '#9a5b00' },
  both: { background: '#f0d9f5', color: '#7a1f8f' },
  other: { background: '#e5e5e5', color: '#333' },
};

export const MONO = '12px "Roboto Mono", Menlo, Consolas, monospace';

/**
 * Storyboard frame 6's terminal repair row. The three repairs are not the same
 * kind of thing: changing the model is something the learner can do here, so it
 * is a button that reruns the same family in place; changing the world or the
 * axiom is a conceptual repair this lesson does not offer, so it is text.
 */
export function RepairRow({
  board,
  witness,
  onSwitchModel,
}: {
  board: Board;
  witness: WitnessModelId | null;
  onSwitchModel: (model: WitnessModelId) => void;
}) {
  const failing = board.tally.evaluated - board.tally.pass;
  if (failing === 0) return null;
  return (
    <ul
      aria-label="repairs"
      data-testid="repair-row"
      style={{ listStyle: 'none', margin: '8px 0', padding: '6px 10px', font: MONO, background: '#f6f3ea', border: '1px solid #d8d4c8' }}
    >
      <li>
        <b>change model</b> · available:{' '}
        {witness === 'reorder-buffer' ? (
          'already sequence-aware'
        ) : (
          <button onClick={() => onSwitchModel('reorder-buffer')}>Switch to reorder-buffer and re-evaluate</button>
        )}
      </li>
      <li style={{ color: '#5f5b4f' }}>
        <b>change world</b> · conceptual, not available here: the arrival orderings are the question, not the fault
      </li>
      <li style={{ color: '#5f5b4f' }}>
        <b>change axiom</b> · conceptual, not available here: followerMaze.orderedRouting is what all 24 worlds share
      </li>
    </ul>
  );
}
