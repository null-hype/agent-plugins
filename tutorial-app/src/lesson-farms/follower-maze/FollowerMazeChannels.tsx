import React from 'react';
import type { Board } from './followerMazeLog';
import { MONO as MONO_FONT, OUTCOME_STYLE } from './FollowerMazeBoardState';

/**
 * CIT-227: the two interaction channels the CIT-199 pre-cog board separates,
 * restored for Follower Maze.
 *
 *   input      -- what enters the system: the reasons the learner types into the warm-log editor
 *   monitor    -- what the current implementation actually emitted for them (this file)
 *   diagnostic -- markers on the warm-log editor: expected trace vs the monitor's trace
 *
 * The monitor shows no verdict. Reconciling the monitor against the protocol
 * is the diagnostic's job, and stays in the warm log's own marker path.
 * Each of the 24 orderings is an alternate execution of this one thread; the
 * family grid selects which execution the two channels show.
 */

const MONO = '12px "Roboto Mono", Menlo, Consolas, monospace';

const pane: React.CSSProperties = { minWidth: 0, border: '1px solid #d8d4c8', background: '#fffdf7', font: MONO };
const title: React.CSSProperties = { padding: '4px 10px', background: '#f6f3ea', borderBottom: '1px solid #d8d4c8', fontWeight: 600 };
const rows: React.CSSProperties = { listStyle: 'none', margin: 0, padding: '6px 10px', minHeight: 112 };

/**
 * Storyboard frame 5 as a message thread: one row per arrival order, each an execution
 * of the same four messages -- what the implementation emitted for it, and (once
 * evaluated) the outcome colour and word. Selecting a row marks the execution the
 * learner is looking at; the row is a pointer to a run, not the run itself.
 */
function ExecutionThread({ board, onSelect }: { board: Board; onSelect?: (name: string) => void }) {
	return (
		<ol data-testid="family-grid" aria-label="executions" style={{ listStyle: 'none', margin: 0, padding: '6px 10px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
			{board.cases.map(({ name, category, emitted, legal }) => {
				const outcome = category ?? 'unevaluated';
				return (
					<li key={name}>
						<button
							type="button"
							data-testid={`chip-${name}`}
							data-outcome={outcome}
							aria-pressed={board.thread.name === name}
							aria-label={`${name}: ${category ?? 'not evaluated'}${legal ? '' : ', illegal order'}`}
							title={legal ? 'legal for the declared reasons' : 'not legal for the declared reasons'}
							onClick={() => onSelect?.(name)}
							style={{
								...OUTCOME_STYLE[outcome],
								font: MONO_FONT,
								width: '100%',
								cursor: 'pointer',
								padding: '3px 6px',
								marginBottom: 3,
								textAlign: 'left',
								border: board.thread.name === name ? '2px solid #222' : '1px solid #d8d4c8',
								display: 'grid',
								gridTemplateColumns: '3.5em 1fr auto',
								gap: 8,
							}}
						>
							<b>{name}{legal ? '' : '*'}</b>
							<span>{emitted ?? 'awaiting send'}</span>
							<span>{category ?? '·'}</span>
						</button>
					</li>
				);
			})}
		</ol>
	);
}

export function MonitorChannel({ board, onSelect }: { board: Board; onSelect?: (name: string) => void }) {
	const { thread } = board;
	const family = board.cases.length > 0;
	return (
		<section aria-label="monitor" data-testid="monitor-channel" style={{ ...pane, display: 'flex', flexDirection: 'column' }}>
			<div style={title}>
				monitor · {family ? `${board.cases.length} runs of the same four messages, one per arrival order (* = not a legal order for the declared reasons)` : `what ${thread.model ?? 'the implementation'} emitted`}
			</div>
			{family ? (
				<ExecutionThread board={board} onSelect={onSelect} />
			) : thread.steps === null ? (
				<div style={{ ...rows, color: '#5f5b4f' }}>
					{board.reasons.ok ? 'awaiting send: nothing has run yet' : 'awaiting reasons: write the four messages first'}
				</div>
			) : (
				<ol style={rows}>
					{thread.steps.map(({ event, emitted, held }, index) => (
						<li key={event.sequence} data-testid={`monitor-${index + 1}`}>
							{index + 1}. on {event.payload} →{' '}
							{emitted.length === 0 ? (
								<span style={{ color: '#5f5b4f' }}>{held ?? 'no delivery'}</span>
							) : (
								emitted.map((d) => `${d.user} <- seq ${d.sequence}`).join(', ')
							)}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

/**
 * Two full-height columns at a 50% split: the warm log on the left (`children`) and the
 * monitor on the right. The log *is* the input channel -- the events as entered, an
 * editor whose markers are the diagnostics -- so nothing else on the board shows one.
 */
export function Channels({ board, onSelect, children }: { board: Board; onSelect?: (name: string) => void; children: React.ReactNode }) {
	return (
		<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '8px 0', alignItems: 'stretch' }}>
			<div style={{ minWidth: 0 }}>{children}</div>
			<MonitorChannel board={board} onSelect={onSelect} />
		</div>
	);
}
