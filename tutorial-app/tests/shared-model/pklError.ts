// Pkl's error text, read for what it states. Shared by the shared model's
// collector (which records what Pkl said of each revision) and the live
// Storybook plugin (which says it of a working copy as it is saved).

/** A place in the module Pkl's error points at: its source line and caret span. */
export type PklLocation = { line: number; column: number; endColumn: number; member?: string };
/**
 * Pkl's error text, read for what it states: the message above the first
 * blank line, then each source excerpt (`N | code`, a caret line, and the
 * `at Module#member` frame), in Pkl's own order. Frames outside the module
 * (the standard library's) are left out.
 */
export function parsePklError(text: string, file: string): { message: string; locations: PklLocation[] } {
	const lines = text.replace(/^–– Pkl Error ––\n/, '').split('\n');
	const message = lines.slice(0, lines.indexOf('')).join('\n');
	const locations: PklLocation[] = [];
	lines.forEach((line, index) => {
		const excerpt = /^(\d+) \| /.exec(line);
		const carets = /^( *)(\^+)$/.exec(lines[index + 1] ?? '');
		const frame = /^at [^#]+#(\S+) \((.*?)(?:, line \d+)?\)$/.exec(lines[index + 2] ?? '');
		if (!excerpt || !carets || !frame || !frame[2].endsWith(file)) return;
		const offset = excerpt[0].length;
		const column = carets[1].length - offset + 1;
		locations.push({ line: Number(excerpt[1]), column, endColumn: column + carets[2].length, member: frame[1] });
	});
	return { message, locations };
}
