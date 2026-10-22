import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import leftPage from './duo/left-page.html?raw';
import { type Card, cards, claimText, CLAIM_LINE } from './duo/cards';
import { leftPageDocument } from './duo/leftPage';

// The left page of the iPhone Duo editor: the demo claim, read-only in Monaco.
// The page is a standalone document so the SwiftUI app can load the same file
// in a WKWebView and drive it with evaluateJavaScript; these play() tests call
// that same window API.

const srcDoc = leftPageDocument(leftPage, claimText);

type Monaco = {
	MarkerSeverity: { Error: number; Info: number };
	editor: {
		EditorOption: { readOnly: number };
		getEditors(): MonacoEditor[];
		getModelMarkers(filter: { owner: string }): { startLineNumber: number; severity: number; code?: string | { value: string }; message: string }[];
	};
};
type MonacoEditor = {
	getOption(option: number): unknown;
	getModel(): {
		getValue(): string;
		getValueInRange(range: unknown): string;
		getLineDecorations(line: number): { range: unknown; options: { inlineClassName?: string; after?: { content: string } } }[];
	};
	trigger(source: string, handler: string, payload: unknown): void;
};
type PageWindow = Window & {
	monaco?: Monaco;
	showCards?: (cards: Card[]) => void;
	previewOption?: (cardId: string, optionId: string) => void;
	clearPreview?: () => void;
};

const meta: Meta = {
	title: 'Duo/Left page',
	parameters: { layout: 'centered', docs: { story: { autoplay: false } } },
};

export default meta;
type Story = StoryObj;

const pageOf = (canvasElement: HTMLElement) => {
	const frame = canvasElement.querySelector('iframe')!;
	const win = frame.contentWindow as PageWindow;
	const monaco = win.monaco!;
	return { win, doc: frame.contentDocument!, monaco, editor: monaco.editor.getEditors()[0] };
};

const previews = (editor: MonacoEditor) =>
	editor.getModel().getLineDecorations(CLAIM_LINE).filter((d) => d.options.inlineClassName === 'duo-preview-removed');

export const TheClaimWithItsCards: Story = {
	name: 'The claim with its cards',
	render: () => <iframe title="duo left page" srcDoc={srcDoc} style={{ width: 390, height: 360, border: '1px solid #d8d4c8' }} />,
	play: async ({ canvasElement, step }) => {
		await waitFor(
			() => {
				const win = canvasElement.querySelector('iframe')?.contentWindow as PageWindow | null | undefined;
				if (!win?.showCards || !win.monaco?.editor.getEditors().length) throw new Error('the left page has not loaded Monaco yet');
			},
			{ timeout: 15000 },
		);
		const { win, doc, monaco, editor } = pageOf(canvasElement);
		const refuted = cards.filter((c) => c.counterexample);
		const [card] = refuted;
		const [option] = card.options;
		win.showCards!(cards);

		await step('The editor is read-only', async () => {
			await expect(editor.getOption(monaco.editor.EditorOption.readOnly)).toBe(true);
			editor.trigger('test', 'type', { text: 'edited' });
			await expect(editor.getModel().getValue()).toBe(claimText);
		});

		await step('Each card has a marker on the claim line; the refuted one is styled as refuted', async () => {
			const markers = monaco.editor.getModelMarkers({ owner: 'duo-cards' });
			await expect(markers.map((m) => m.code).sort()).toEqual(cards.map((c) => c.id).sort());
			for (const marker of markers) {
				const isRefuted = refuted.some((c) => c.id === marker.code);
				await expect(marker.startLineNumber).toBe(CLAIM_LINE);
				await expect(marker.severity).toBe(isRefuted ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Info);
				await expect(marker.message.startsWith('Refuted: ')).toBe(isRefuted);
			}
			await waitFor(() => {
				if (!doc.querySelector('.squiggly-error')) throw new Error('no refuted squiggle is rendered');
				if (!doc.querySelector('.squiggly-info')) throw new Error('no open squiggle is rendered');
			});
		});

		await step('previewOption adds the option as a diff decoration', async () => {
			win.previewOption!(card.id, option.id);
			const [removed] = previews(editor);
			await expect(previews(editor)).toHaveLength(1);
			await expect(editor.getModel().getValueInRange(removed.range)).toBe(option.from);
			await expect(removed.options.after?.content).toBe(option.to);
			await expect(editor.getModel().getValue()).toBe(claimText);
			await waitFor(() => {
				if (!doc.querySelector('.duo-preview-removed')) throw new Error('the removed text is not rendered as a diff');
			});
		});

		await step('clearPreview removes it', async () => {
			win.clearPreview!();
			await expect(previews(editor)).toHaveLength(0);
			await waitFor(() => {
				if (doc.querySelector('.duo-preview-removed')) throw new Error('the diff is still rendered');
			});
		});
	},
};
