import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimText } from './cards';
import { CLAIM_SLOT, leftPageDocument } from './leftPage';

const template = readFileSync(new URL('./left-page.html', import.meta.url), 'utf8');

const claimOf = (html: string) => {
	const match = html.match(/<script id="claim" type="application\/json">(.*?)<\/script>/s);
	if (!match) throw new Error('no #claim element');
	return JSON.parse(match[1]);
};

describe('leftPageDocument', () => {
	it('puts the claim in the #claim element and leaves no slot behind', () => {
		const html = leftPageDocument(template, claimText);
		expect(html).not.toContain(CLAIM_SLOT);
		expect(claimOf(html)).toBe(claimText);
	});

	it('keeps claim text that would break out of the script element or a replacement pattern', () => {
		const nasty = 'a </script><script>alert(1)</script> $& $1 $`';
		const html = leftPageDocument(template, nasty);
		expect(claimOf(html)).toBe(nasty);
		expect(html.match(/<\/script>/g)).toHaveLength(template.match(/<\/script>/g)!.length + 1);
	});

	it('refuses a template with no slot', () => {
		expect(() => leftPageDocument('<html></html>', 'x')).toThrow(CLAIM_SLOT);
	});
});
