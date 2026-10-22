import cardsJson from './cards.json';
import matBlocked from '../../../evidence/cit-294-review-history-v1/files/cc23e89297855dd07b1ee477ced455ab46a94738/docs/investigations/CIT-265/cit-294/observations/mat-blocked.json';

// The demo cards for the Duo left page. Cards.pkl defines them from CIT-294's
// recorded runs (the observations at cc23e89) and `pkl eval Cards.pkl` renders
// cards.json, which is exactly what the page's `showCards` takes.
// cards.spec.ts fails if the two drift apart.

export type Option = { id: string; label: string; from: string; to: string };
export type Card = { id: string; line: number; title: string; counterexample?: string; options: Option[] };

export const cards: Card[] = cardsJson;
export const CLAIM_LINE = cards[0].line;

// Authored: the claim sentence has no recorded source yet. Provisional.
const setting = matBlocked;
export const claimText = [
	`Rails ${setting.independent_rails_load_defaults}, Active Storage ${setting.independent_active_storage_variant_processor}, declared ${setting.declared_content_type}`,
	'Uploads are always resized.',
].join('\n');
