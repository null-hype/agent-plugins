import { waitFor } from 'storybook/test';

// Helpers for play() functions that read the two acp-trace preview iframes
// (Client, Agent). Copied from AcpTrace.stories.tsx, which still carries its
// own copies; deduplicating the two is a follow-up.

export const editorsReady = (canvasElement: HTMLElement) =>
	waitFor(
		() => {
			const frames = Array.from(canvasElement.querySelectorAll('iframe'));
			if (frames.length < 2) throw new Error('expected two preview iframes (client, agent)');
			for (const frame of frames) {
				if (!frame.contentDocument?.querySelector('.monaco-editor .view-line')) {
					throw new Error('Monaco has not rendered in every pane yet');
				}
			}
		},
		{ timeout: 15000 },
	);

export const clientDocument = (canvasElement: HTMLElement) => canvasElement.querySelectorAll('iframe')[0]?.contentDocument;

export const clientText = (canvasElement: HTMLElement) =>
	(clientDocument(canvasElement)?.querySelector('.monaco-editor .view-lines')?.textContent ?? '').replace(/\u00a0/g, ' ');

export const expectClientShows = (canvasElement: HTMLElement, needle: string) =>
	waitFor(() => {
		const text = clientText(canvasElement);
		if (!text.includes(needle)) throw new Error(`client pane does not show "${needle}"; it shows: ${text.slice(0, 300)}`);
	});

// Monaco CodeLens commands run on mouseup, so a plain click() is not enough.
export const clickInFrame = (el: HTMLElement) => {
	const win = el.ownerDocument.defaultView!;
	for (const type of ['mousedown', 'mouseup', 'click']) {
		el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win }));
	}
};
