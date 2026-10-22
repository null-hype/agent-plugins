import matBlocked from '../../../evidence/cit-294-review-history-v1/files/cc23e89297855dd07b1ee477ced455ab46a94738/docs/investigations/CIT-265/cit-294/observations/mat-blocked.json';
import matUnblocked from '../../../evidence/cit-294-review-history-v1/files/cc23e89297855dd07b1ee477ced455ab46a94738/docs/investigations/CIT-265/cit-294/observations/mat-unblocked.json';
import pngBlocked from '../../../evidence/cit-294-review-history-v1/files/cc23e89297855dd07b1ee477ced455ab46a94738/docs/investigations/CIT-265/cit-294/observations/png-blocked.json';
import pngUnblocked from '../../../evidence/cit-294-review-history-v1/files/cc23e89297855dd07b1ee477ced455ab46a94738/docs/investigations/CIT-265/cit-294/observations/png-unblocked.json';

// The demo cards for the Duo left page, projected from CIT-294's recorded runs
// (the observations at cc23e89, the last commit of #120). One card per run.
// A run where the upload was not resized is a counterexample to the claim, so
// its card is refuted; the rest stay open.

type Observation = {
	arm: string;
	block_untrusted_env: string | null;
	declared_content_type: string;
	loader_selected: string | null;
	variant_succeeded: boolean;
	variant_error?: string;
	independent_rails_load_defaults: string;
	independent_active_storage_variant_processor: string;
};

export type Option = { id: string; label: string; from: string; to: string };
export type Card = { id: string; line: number; title: string; counterexample?: string; options: Option[] };

const runs: Record<string, Observation> = {
	'mat-blocked': matBlocked,
	'mat-unblocked': matUnblocked,
	'png-blocked': pngBlocked,
	'png-unblocked': pngUnblocked,
};

// Authored: the claim sentence and the rewrites an option offers have no
// recorded source yet. Provisional until the question templates exist.
export const CLAIM_LINE = 2;
const CLAIM = 'Uploads are always resized.';
const OPTIONS: Option[] = [
	{ id: 'unless-blocked', label: 'Unless the loader is blocked', from: 'always resized', to: 'resized unless the loader is blocked' },
	{ id: 'png-only', label: 'Only PNG uploads', from: 'Uploads', to: 'PNG uploads' },
];

const setting = matBlocked;
export const claimText = [
	`Rails ${setting.independent_rails_load_defaults}, Active Storage ${setting.independent_active_storage_variant_processor}, declared ${setting.declared_content_type}`,
	CLAIM,
].join('\n');

export const cards: Card[] = Object.entries(runs).map(([id, run]) => ({
	id,
	line: CLAIM_LINE,
	title: `${run.arm} upload, untrusted loaders ${run.block_untrusted_env ? 'blocked' : 'not blocked'}`,
	...(run.variant_succeeded ? {} : { counterexample: run.variant_error }),
	options: OPTIONS,
}));
