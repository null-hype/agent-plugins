import React from 'react';
import { badgeText, counterText, legalText, type Board } from './followerMazeLog';

/**
 * The persistent frame elements from the CIT-203 storyboard: the axiom badge
 * and the counter footer. Both are derived from the same records the warm log
 * renders -- the badge from the distinct axioms those records cite (a second
 * entry turns it red: the transfer claim failing is visible, not asserted),
 * the footer from their verdict flags. This shows board *state*; every
 * diagnostic itself (squiggle, hover, lens, evidence) is drawn by the warm log.
 */
export default function FollowerMazeStatus({ board }: { board: Board }) {
	const failed = board.axiomIds.length !== 1;
	return (
		<div
			role="status"
			style={{
				display: 'flex',
				justifyContent: 'space-between',
				gap: 12,
				padding: '6px 10px',
				font: '12px "Roboto Mono", Menlo, Consolas, monospace',
				background: '#f6f3ea',
				border: '1px solid #d8d4c8',
			}}
		>
			<span data-testid="axiom-badge" style={{ color: failed ? '#b3261e' : '#1a7f37', fontWeight: 600 }}>
				{badgeText(board)}
			</span>
			<span data-testid="legal-worlds">{legalText(board)}</span>
			<span data-testid="counter-footer">{counterText(board.tally)}</span>
		</div>
	);
}
