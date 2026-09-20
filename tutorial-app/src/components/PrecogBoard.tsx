import React, { useState } from 'react';
import {
	createEmptyBoard,
	reconcileBoard,
	type SealedPrediction,
	type PassMonitorLogEntry,
	type RepairChoice,
	type PrecogBoardState,
	toAcpPlanUpdate,
} from '../lib/precogReconciler';
import './PrecogBoard.css';

export type StoryboardStep =
	| '1_render'
	| '2_predict'
	| '3_log'
	| '4_unpredicted_log'
	| '5_run_end'
	| '6_hover_alarm';

const PREDICTIONS: SealedPrediction[] = [
	{
		id: 'L1',
		line: 1,
		purpose: 'deploy',
		target: 'ci/deploy-key',
		sealedAt: '2026-09-20T10:00:00Z',
	},
	{
		id: 'L2',
		line: 2,
		purpose: 'migrate',
		target: 'prod/db-admin',
		sealedAt: '2026-09-20T10:00:00Z',
	},
];

const LOG_1: PassMonitorLogEntry = {
	id: 'log-001',
	timestamp: '2026-09-20T10:01:00Z',
	reason: 'deploy staging',
	target: 'ci/deploy-key',
};

const LOG_2: PassMonitorLogEntry = {
	id: 'log-002',
	timestamp: '2026-09-20T10:02:00Z',
	reason: 'rotate token',
	target: 'prod/db-admin',
};

export interface PrecogBoardProps {
	initialStep?: StoryboardStep;
}

export default function PrecogBoard({ initialStep = '1_render' }: PrecogBoardProps) {
	const [step, setStep] = useState<StoryboardStep>(initialStep);
	const [repairs, setRepairs] = useState<Record<string, RepairChoice>>({});
	const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);

	// Compute board state based on current step
	let boardState: PrecogBoardState;

	switch (step) {
		case '1_render':
			boardState = createEmptyBoard();
			break;
		case '2_predict':
			boardState = reconcileBoard(PREDICTIONS, []);
			break;
		case '3_log':
			boardState = reconcileBoard(PREDICTIONS, [LOG_1]);
			break;
		case '4_unpredicted_log':
			boardState = reconcileBoard(PREDICTIONS, [LOG_1, LOG_2], { repairs });
			break;
		case '5_run_end':
			boardState = reconcileBoard(PREDICTIONS, [LOG_1, LOG_2], { runEnded: true, repairs });
			break;
		case '6_hover_alarm':
			boardState = reconcileBoard(PREDICTIONS, [LOG_1, LOG_2], { runEnded: true, repairs });
			break;
		default:
			boardState = createEmptyBoard();
	}

	const steps: StoryboardStep[] = [
		'1_render',
		'2_predict',
		'3_log',
		'4_unpredicted_log',
		'5_run_end',
		'6_hover_alarm',
	];

	const nextStep = () => {
		const idx = steps.indexOf(step);
		if (idx < steps.length - 1) {
			setStep(steps[idx + 1]);
		} else {
			setStep('1_render');
		}
	};

	const handleRepair = (entryId: string, choice: RepairChoice) => {
		setRepairs((prev) => ({ ...prev, [entryId]: choice }));
	};

	const acpPlan = toAcpPlanUpdate(boardState);

	return (
		<div className="precog-container" data-step={step}>
			{/* Top Bar: Controls & Storyboard Progress */}
			<header className="precog-header">
				<div className="precog-title-group">
					<span className="precog-title">Pre-cog board · play() storyboard</span>
					<span className="precog-step-badge">{step.replace('_', ' · ')}</span>
				</div>
				<div className="precog-controls">
					<button className="precog-btn-next" onClick={nextStep}>
						Next State →
					</button>
				</div>
			</header>

			{/* Sub-header: Live Counters & Status */}
			<div className="precog-status-strip">
				<div className="precog-counters" data-testid="precog-counters">
					<span className="counter-item">{boardState.counts.sealed} sealed</span>
					<span className="counter-sep">·</span>
					<span className="counter-item">{boardState.counts.done} done</span>
					<span className="counter-sep">·</span>
					<span className="counter-item">{boardState.counts.stale} stale</span>
					<span className="counter-sep">·</span>
					<span className="counter-item">{boardState.counts.alarms} alarm{boardState.counts.alarms === 1 ? '' : 's'}</span>
				</div>
				{boardState.sealHash && (
					<div className="precog-seal-hash">
						<span className="seal-label">SEAL:</span> {boardState.sealHash}
					</div>
				)}
			</div>

			{/* Two-Column Board Layout */}
			<div className="precog-columns">
				{/* Left Pane: Pre-cog Predictions (Typed Pkl Channel) */}
				<section className="precog-pane precog-predictions-pane">
					<div className="pane-header">
						<span className="pane-title">PRE-COG PREDICTIONS (PKL)</span>
						<span className="pane-protocol-tag">LSP + ACP Plan</span>
					</div>

					<div className="pane-content">
						{boardState.entries.length === 0 ? (
							<div className="precog-empty-prompt">
								<code>// type a prediction</code>
							</div>
						) : (
							<div className="precog-entry-list">
								{boardState.entries.map((entry) => {
									const isAlarm = entry.state === 'alarm';
									const isHovered =
										hoveredEntryId === entry.id || step === '6_hover_alarm';

									return (
										<div
											key={entry.id}
											className={`precog-entry-row row-${entry.state} ${
												isHovered ? 'hovered' : ''
											}`}
											onMouseEnter={() => setHoveredEntryId(entry.id)}
											onMouseLeave={() => setHoveredEntryId(null)}
											data-testid={`entry-${entry.id}`}
										>
											<div className="entry-main">
												<span className="entry-indicator">
													{isAlarm ? '!!' : entry.id}
												</span>
												<span className="entry-purpose">{entry.purpose}</span>
												<span className="entry-dot">·</span>
												<span className="entry-target">{entry.target}</span>
												<span className={`entry-badge badge-${entry.state}`}>
													{entry.state === 'done'
														? 'DONE'
														: entry.state === 'stale'
														? 'STALE'
														: entry.state === 'alarm'
														? 'NOT PREDICTED'
														: 'sealed'}
												</span>
											</div>

											{/* Alarm Near-Miss Diagnostic Callout */}
											{isAlarm && (step === '6_hover_alarm' || isHovered) && (
												<div className="precog-alarm-popover" data-testid="alarm-popover">
													<div className="alarm-diag-text">
														{entry.nearMiss?.message || 'Unpredicted capability access'}
													</div>
													<div className="repair-buttons">
														<button
															className={`repair-btn ${
																entry.repairChoice === 'change_world' ? 'selected' : ''
															}`}
															onClick={() => handleRepair(entry.id, 'change_world')}
														>
															change world
														</button>
														<button
															className={`repair-btn ${
																entry.repairChoice === 'change_model' ? 'selected' : ''
															}`}
															onClick={() => handleRepair(entry.id, 'change_model')}
														>
															change model
														</button>
														<button
															className={`repair-btn ${
																entry.repairChoice === 'change_axiom' ? 'selected' : ''
															}`}
															onClick={() => handleRepair(entry.id, 'change_axiom')}
														>
															change axiom
														</button>
													</div>
													{entry.repairChoice && (
														<div className="selected-repair-note">
															Selected repair: <strong>{entry.repairChoice.replace('_', ' ')}</strong>
														</div>
													)}
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				</section>

				{/* Right Pane: Pass Agent Monitor (Observation Channel) */}
				<section className="precog-pane precog-monitor-pane">
					<div className="pane-header">
						<span className="pane-title">PASS AGENT MONITOR</span>
						<span className="pane-protocol-tag">OTel Ledger</span>
					</div>

					<div className="pane-content">
						{boardState.logs.length === 0 ? (
							<div className="monitor-idle">
								<span className="idle-indicator">●</span> monitor idle
							</div>
						) : (
							<div className="monitor-log-list">
								{boardState.logs.map((log) => (
									<div key={log.id} className="monitor-log-item">
										<div className="log-reason">{log.reason}</div>
										<div className="log-target">{log.target}</div>
										<div className="log-time">{log.timestamp.slice(11, 19)}</div>
									</div>
								))}
								{boardState.runEnded && (
									<div className="monitor-run-ended">-- run ended --</div>
								)}
							</div>
						)}
					</div>
				</section>
			</div>

			{/* Footer: ACP Plan Protocol Live Broadcast */}
			<footer className="precog-footer">
				<div className="footer-protocol-title">
					<span>ACP plan_update broadcast ({acpPlan.entries.length} entries)</span>
				</div>
				<div className="footer-plan-entries">
					{acpPlan.entries.length === 0 ? (
						<span className="plan-entry-empty">no entries</span>
					) : (
						acpPlan.entries.map((pe) => (
							<span key={pe.id} className={`plan-entry status-${pe.status}`}>
								{pe.id}: <em>{pe.status}</em>
							</span>
						))
					)}
				</div>
			</footer>
		</div>
	);
}
