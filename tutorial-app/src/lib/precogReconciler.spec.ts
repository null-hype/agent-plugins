import { describe, it, expect } from 'vitest';
import {
	createEmptyBoard,
	reconcileBoard,
	toAcpPlanUpdate,
	toAcpToolCalls,
	type SealedPrediction,
	type PassMonitorLogEntry,
} from './precogReconciler';

describe('PrecogReconciler (CIT-199)', () => {
	const pred1: SealedPrediction = {
		id: 'L1',
		line: 1,
		purpose: 'deploy',
		target: 'ci/deploy-key',
		sealedAt: '2026-09-20T10:00:00Z',
	};

	const pred2: SealedPrediction = {
		id: 'L2',
		line: 2,
		purpose: 'migrate',
		target: 'prod/db-admin',
		sealedAt: '2026-09-20T10:00:00Z',
	};

	const log1: PassMonitorLogEntry = {
		id: 'log-001',
		timestamp: '2026-09-20T10:01:00Z',
		reason: 'deploy staging',
		target: 'ci/deploy-key',
	};

	const unpredictedLog: PassMonitorLogEntry = {
		id: 'log-002',
		timestamp: '2026-09-20T10:02:00Z',
		reason: 'rotate token',
		target: 'prod/db-admin',
	};

	it('Step 1 · render: empty board has zero counters and empty entries', () => {
		const board = createEmptyBoard();
		expect(board.entries).toHaveLength(0);
		expect(board.counts).toEqual({ sealed: 0, done: 0, stale: 0, alarms: 0 });
		expect(board.runEnded).toBe(false);

		const acpUpdate = toAcpPlanUpdate(board);
		expect(acpUpdate.entries).toHaveLength(0);
	});

	it('Step 2 · predict: typed Pkl predictions sealed prior to action', () => {
		const board = reconcileBoard([pred1, pred2], []);
		expect(board.entries).toHaveLength(2);
		expect(board.counts).toEqual({ sealed: 2, done: 0, stale: 0, alarms: 0 });
		expect(board.entries[0].state).toBe('sealed');
		expect(board.entries[0].acpStatus).toBe('pending');
		expect(board.entries[1].state).toBe('sealed');
		expect(board.entries[1].acpStatus).toBe('pending');
		expect(board.sealHash).toBeDefined();

		const acpUpdate = toAcpPlanUpdate(board);
		expect(acpUpdate.entries).toEqual([
			{ id: 'L1', title: 'deploy · ci/deploy-key', status: 'pending' },
			{ id: 'L2', title: 'migrate · prod/db-admin', status: 'pending' },
		]);
	});

	it('Step 3 · log: L1 reason and access record match -> flips to DONE', () => {
		const board = reconcileBoard([pred1, pred2], [log1]);
		expect(board.counts).toEqual({ sealed: 1, done: 1, stale: 0, alarms: 0 });
		expect(board.entries[0].state).toBe('done');
		expect(board.entries[0].acpStatus).toBe('completed');
		expect(board.entries[0].matchedLog?.id).toBe('log-001');
		expect(board.entries[1].state).toBe('sealed');
		expect(board.entries[1].acpStatus).toBe('pending');

		const acpUpdate = toAcpPlanUpdate(board);
		expect(acpUpdate.entries[0].status).toBe('completed');
		expect(acpUpdate.entries[1].status).toBe('pending');

		const toolCalls = toAcpToolCalls(board);
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].matchedPlanEntryId).toBe('L1');
	});

	it('Step 4 · unpredicted log: alarm row with near-miss divergence diagnosis', () => {
		const board = reconcileBoard([pred1, pred2], [log1, unpredictedLog]);
		expect(board.counts).toEqual({ sealed: 1, done: 1, stale: 0, alarms: 1 });

		const alarm = board.entries.find((e) => e.state === 'alarm');
		expect(alarm).toBeDefined();
		expect(alarm!.acpStatus).toBe('_unpredicted');
		expect(alarm!.purpose).toBe('rotate token');
		expect(alarm!.target).toBe('prod/db-admin');

		// Near-miss verification: same target as L2, different purpose
		expect(alarm!.nearMiss).toBeDefined();
		expect(alarm!.nearMiss?.conflictingPredictionId).toBe('L2');
		expect(alarm!.nearMiss?.message).toBe('same target as L2, different purpose');

		const acpUpdate = toAcpPlanUpdate(board);
		expect(acpUpdate.entries).toContainEqual({
			id: 'alarm_log-002',
			title: '!! rotate token · prod/db-admin',
			status: '_unpredicted',
		});
	});

	it('Step 5 · run ends: unmatched sealed prediction L2 turns STALE', () => {
		const board = reconcileBoard([pred1, pred2], [log1, unpredictedLog], { runEnded: true });
		expect(board.counts).toEqual({ sealed: 0, done: 1, stale: 1, alarms: 1 });

		const l2 = board.entries.find((e) => e.id === 'L2');
		expect(l2?.state).toBe('stale');
		expect(l2?.acpStatus).toBe('_stale');

		const acpUpdate = toAcpPlanUpdate(board);
		expect(acpUpdate.entries.find((e) => e.id === 'L2')?.status).toBe('_stale');
	});

	it('Step 6 · hover alarm: applies supervisor repair choice', () => {
		const board = reconcileBoard([pred1, pred2], [log1, unpredictedLog], {
			runEnded: true,
			repairs: {
				'alarm_log-002': 'change_world',
			},
		});

		const alarm = board.entries.find((e) => e.state === 'alarm');
		expect(alarm?.repairChoice).toBe('change_world');
	});

	it('Ordering proof: predictions sealed AFTER log cannot match', () => {
		const latePrediction: SealedPrediction = {
			id: 'L1',
			line: 1,
			purpose: 'deploy',
			target: 'ci/deploy-key',
			sealedAt: '2026-09-20T10:05:00Z', // 4 minutes after log1
		};

		const board = reconcileBoard([latePrediction], [log1]);
		// Should NOT match because log was observed before prediction was sealed
		expect(board.counts.done).toBe(0);
		expect(board.counts.sealed).toBe(1);
		expect(board.counts.alarms).toBe(1);
	});
});
