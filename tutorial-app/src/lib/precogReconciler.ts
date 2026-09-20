/**
 * Pre-cog Board Reconciler (CIT-199)
 * 
 * Reconciles sealed capability predictions against Pass agent monitor logs.
 * Deterministic matching of typed records against observed access records,
 * with ACP plan_update protocol mapping and near-miss alarm diagnosis.
 */

export type LineState = 'sealed' | 'done' | 'stale' | 'alarm';

export type AcpPlanEntryStatus = 'pending' | 'completed' | '_stale' | '_unpredicted';

export type RepairChoice = 'change_world' | 'change_model' | 'change_axiom';

export interface SealedPrediction {
	id: string; // e.g. "L1", "L2"
	line: number;
	purpose: string; // e.g. "deploy", "migrate"
	target: string; // e.g. "ci/deploy-key", "prod/db-admin"
	vault?: string;
	sealedAt: string; // ISO timestamp
	hash?: string; // seal snapshot hash
}

export interface PassMonitorLogEntry {
	id: string;
	timestamp: string; // ISO timestamp
	reason: string; // stated reason, e.g. "deploy staging", "rotate token"
	target: string; // item accessed, e.g. "ci/deploy-key", "prod/db-admin"
	vault?: string;
}

export interface NearMissDiagnostic {
	conflictingPredictionId: string;
	conflictingTarget: string;
	message: string; // e.g. "same target as L2, different purpose"
}

export interface BoardEntry {
	id: string;
	line?: number;
	purpose: string;
	target: string;
	state: LineState;
	acpStatus: AcpPlanEntryStatus;
	prediction?: SealedPrediction;
	matchedLog?: PassMonitorLogEntry;
	nearMiss?: NearMissDiagnostic;
	repairChoice?: RepairChoice;
}

export interface BoardCounts {
	sealed: number;
	done: number;
	stale: number;
	alarms: number;
}

export interface PrecogBoardState {
	entries: BoardEntry[];
	counts: BoardCounts;
	logs: PassMonitorLogEntry[];
	runEnded: boolean;
	sealHash?: string;
}

export interface AcpPlanEntry {
	id: string;
	title: string;
	status: AcpPlanEntryStatus;
}

export interface AcpPlanUpdate {
	entries: AcpPlanEntry[];
}

export interface AcpToolCall {
	id: string;
	tool: string;
	input: {
		reason: string;
		target: string;
		vault?: string;
	};
	matchedPlanEntryId?: string;
	timestamp: string;
}

/**
 * Creates initial empty board state.
 */
export function createEmptyBoard(): PrecogBoardState {
	return {
		entries: [],
		counts: { sealed: 0, done: 0, stale: 0, alarms: 0 },
		logs: [],
		runEnded: false,
	};
}

/**
 * Computes deterministic hash for sealed predictions.
 */
export function computeSealHash(predictions: SealedPrediction[]): string {
	const payload = predictions
		.map((p) => `${p.id}:${p.line}:${p.purpose}:${p.target}:${p.sealedAt}`)
		.join('|');
	let hash = 0;
	for (let i = 0; i < payload.length; i++) {
		hash = (hash << 5) - hash + payload.charCodeAt(i);
		hash |= 0;
	}
	return `seal_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Normalizes strings for matching.
 */
function normalize(str: string): string {
	return str.trim().toLowerCase();
}

/**
 * Checks if a reason aligns with a predicted purpose.
 */
function reasonMatchesPurpose(reason: string, purpose: string): boolean {
	const nReason = normalize(reason);
	const nPurpose = normalize(purpose);
	return nReason.includes(nPurpose) || nPurpose.includes(nReason);
}

/**
 * Reconciles sealed predictions against incoming monitor logs.
 */
export function reconcileBoard(
	predictions: SealedPrediction[],
	logs: PassMonitorLogEntry[],
	options: { runEnded?: boolean; repairs?: Record<string, RepairChoice> } = {}
): PrecogBoardState {
	const runEnded = Boolean(options.runEnded);
	const repairs = options.repairs || {};

	// Track which logs and predictions have been matched
	const matchedPredictionIds = new Set<string>();
	const matchedLogIds = new Set<string>();
	const predictionMatches = new Map<string, PassMonitorLogEntry>();

	// 1. Process logs in chronological order to find predictions sealed BEFORE log
	for (const log of logs) {
		const logTime = new Date(log.timestamp).getTime();

		for (const pred of predictions) {
			if (matchedPredictionIds.has(pred.id)) continue;

			const predTime = new Date(pred.sealedAt).getTime();
			// Ordering proof: sealedAt must precede or equal log timestamp
			if (predTime > logTime) {
				continue;
			}

			// Deterministic match on access target and purpose
			if (normalize(pred.target) === normalize(log.target) && reasonMatchesPurpose(log.reason, pred.purpose)) {
				matchedPredictionIds.add(pred.id);
				matchedLogIds.add(log.id);
				predictionMatches.set(pred.id, log);
				break;
			}
		}
	}

	const entries: BoardEntry[] = [];

	// 2. Build entries for predictions (DONE, STALE, or SEALED)
	for (const pred of predictions) {
		const isMatched = matchedPredictionIds.has(pred.id);
		let state: LineState;
		let acpStatus: AcpPlanEntryStatus;

		if (isMatched) {
			state = 'done';
			acpStatus = 'completed';
		} else if (runEnded) {
			state = 'stale';
			acpStatus = '_stale';
		} else {
			state = 'sealed';
			acpStatus = 'pending';
		}

		entries.push({
			id: pred.id,
			line: pred.line,
			purpose: pred.purpose,
			target: pred.target,
			state,
			acpStatus,
			prediction: pred,
			matchedLog: predictionMatches.get(pred.id),
			repairChoice: repairs[pred.id],
		});
	}

	// 3. Any unmatched log becomes an ALARM (NOT PREDICTED)
	for (const log of logs) {
		if (matchedLogIds.has(log.id)) continue;

		// Check for near-miss divergence: same target as an existing prediction, different purpose
		const nearMissPred = predictions.find((p) => normalize(p.target) === normalize(log.target));
		const nearMiss: NearMissDiagnostic | undefined = nearMissPred
			? {
					conflictingPredictionId: nearMissPred.id,
					conflictingTarget: nearMissPred.target,
					message: `same target as ${nearMissPred.id}, different purpose`,
			  }
			: undefined;

		const alarmId = `alarm_${log.id}`;
		entries.push({
			id: alarmId,
			purpose: log.reason,
			target: log.target,
			state: 'alarm',
			acpStatus: '_unpredicted',
			matchedLog: log,
			nearMiss,
			repairChoice: repairs[alarmId],
		});
	}

	// 4. Compute counters
	const counts: BoardCounts = {
		sealed: entries.filter((e) => e.state === 'sealed').length,
		done: entries.filter((e) => e.state === 'done').length,
		stale: entries.filter((e) => e.state === 'stale').length,
		alarms: entries.filter((e) => e.state === 'alarm').length,
	};

	return {
		entries,
		counts,
		logs,
		runEnded,
		sealHash: computeSealHash(predictions),
	};
}

/**
 * Protocol mapping: Pre-cog lines -> ACP plan_update.
 * Item-based plans resend the full entry list on every update.
 */
export function toAcpPlanUpdate(state: PrecogBoardState): AcpPlanUpdate {
	return {
		entries: state.entries.map((entry) => ({
			id: entry.id,
			title: `${entry.id.startsWith('alarm_') ? '!! ' : ''}${entry.purpose} · ${entry.target}`,
			status: entry.acpStatus,
		})),
	};
}

/**
 * Protocol mapping: Pass monitor entries -> ACP tool_call linked to plan entry.
 */
export function toAcpToolCalls(state: PrecogBoardState): AcpToolCall[] {
	return state.logs.map((log) => {
		const matchedEntry = state.entries.find((e) => e.matchedLog?.id === log.id);
		return {
			id: log.id,
			tool: 'pass-cli',
			input: {
				reason: log.reason,
				target: log.target,
				vault: log.vault,
			},
			matchedPlanEntryId: matchedEntry?.id,
			timestamp: log.timestamp,
		};
	});
}
