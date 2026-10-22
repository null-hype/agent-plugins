import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cards, CLAIM_LINE, claimText } from './cards';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const pkl = (...args: string[]) => execFileSync('pkl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Cards.pkl is the one definition of the demo cards; these fail when what the
// left page receives stops being what it renders. Pkl is required, not skipped:
// a skipped drift check would pass on exactly the machines that cannot see drift.
describe('the Duo cards', () => {
	const rendered = pkl('eval', here('./Cards.pkl'));

	it('are what Cards.pkl renders, as committed in cards.json', () => {
		expect(readFileSync(here('./cards.json'), 'utf8')).toBe(rendered);
	});

	it('are what the left page receives from cards.ts', () => {
		expect(cards).toEqual(JSON.parse(rendered));
	});

	it('pass Cards.test.pkl', () => {
		expect(pkl('test', here('./Cards.test.pkl'))).toContain('100.0% tests pass');
	});

	it('offer rewrites of text that is on the claim line', () => {
		const line = claimText.split('\n')[CLAIM_LINE - 1];
		for (const card of cards) for (const option of card.options) expect(line).toContain(option.from);
	});
});
