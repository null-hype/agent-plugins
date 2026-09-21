import { atom } from 'nanostores';

// Stands in for TutorialKit's `tutorialkit:store` virtual module (aliased in
// main.ts) so the real bridge components run in Storybook. It mirrors only the
// surface the bridges consume, with the same shapes as
// @tutorialkit/runtime's TutorialStore:
//
//   documents / currentDocument  -> ReadableAtom (bridges wrap in useStore)
//   lesson                       -> a plain value, read directly, NOT an atom
//   setSelectedFile(path)        -> switches the current document
//
// Stories seed it from a lesson's real files and frontmatter; nothing here
// derives lesson state.

export type EditorDocument = {
	filePath: string;
	loading: boolean;
	value: string | Uint8Array;
};

type Lesson = { data: Record<string, unknown> };

const documents = atom<Record<string, EditorDocument | undefined>>({});
const currentDocument = atom<EditorDocument | undefined>(undefined);
let lesson: Lesson | undefined;

const tutorialStore = {
	get documents() {
		return documents;
	},
	get currentDocument() {
		return currentDocument;
	},
	get lesson() {
		return lesson;
	},
	setSelectedFile(filePath: string | undefined) {
		currentDocument.set(filePath ? documents.get()[filePath] : undefined);
	},
};

export default tutorialStore;

function toDocuments(files: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(files).map(([filePath, value]) => [
			filePath,
			{ filePath, loading: false, value } satisfies EditorDocument,
		]),
	);
}

// Seed the store the way TutorialKit does after loading a lesson: every file
// is a document, `focus` is the open one, `data` is the lesson frontmatter.
export function seedTutorialStore(options: {
	data: Record<string, unknown>;
	files: Record<string, string>;
	focus?: string;
}) {
	lesson = { data: options.data };
	documents.set(toDocuments(options.files));
	currentDocument.set(options.focus ? documents.get()[options.focus] : undefined);
}

// What TutorialKit's editor does on every keystroke, and what Solve/Reset do
// wholesale: replace file contents in the store.
export function setDocuments(files: Record<string, string>) {
	documents.set({ ...documents.get(), ...toDocuments(files) });
	const open = currentDocument.get();
	if (open) currentDocument.set(documents.get()[open.filePath]);
}

export function resetTutorialStore() {
	lesson = undefined;
	documents.set({});
	currentDocument.set(undefined);
}
