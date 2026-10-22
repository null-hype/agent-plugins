// The one projection of the claim into the left page: Storybook's srcDoc and the
// exported file for the native client both come from here.
export const CLAIM_SLOT = '<!--claim-->';

export function leftPageDocument(template: string, claimText: string): string {
	if (!template.includes(CLAIM_SLOT)) throw new Error(`left page template has no ${CLAIM_SLOT} slot`);
	// "<" is escaped so claim text can never close the script element early.
	const json = JSON.stringify(claimText).replaceAll('<', '\\u003c');
	return template.replace(CLAIM_SLOT, () => `<script id="claim" type="application/json">${json}</script>`);
}
