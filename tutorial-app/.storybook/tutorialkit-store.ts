import { atom } from 'nanostores';

// Stands in for TutorialKit's `tutorialkit:store` virtual module (aliased in
// main.ts) so the real bridge components run in Storybook. It mirrors only the
// surface the bridges consume, with the same shapes as
// @tutorialkit/runtime's TutorialStore:
//
//   documents / currentDocument  -> ReadableAtom (bridges wrap in useStore)
//   lesson                       -> a plain value, read directly, NOT an atom
//   setSelectedFile(path)        -> switches the current document
//   lessonFullyLoaded            -> ReadableAtom<boolean> (CIT-245)
//   hasSolution()/solve()/reset() -> the real store's own names and effect
//     (CIT-245: AcpTraceBridge calls these directly, since `editor: false`
//     collapses TutorialKit's own Solve button to zero size)
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
const lessonFullyLoaded = atom<boolean>(true);
let lesson: Lesson | undefined;
let seededFiles: Record<string, string> = {};
let seededSolution: Record<string, string> | undefined;

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
	get lessonFullyLoaded() {
		return lessonFullyLoaded;
	},
	setSelectedFile(filePath: string | undefined) {
		currentDocument.set(filePath ? documents.get()[filePath] : undefined);
	},
	hasSolution() {
		return !!seededSolution && Object.keys(seededSolution).length > 0;
	},
	solve() {
		if (!seededSolution) return;
		setDocuments({ ...seededFiles, ...seededSolution });
	},
	reset() {
		setDocuments(seededFiles);
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
// `solution`, when given, is what `solve()` merges over `files` -- the same
// pair a real lesson ships as `_files`/`_solution`.
export function seedTutorialStore(options: {
	data: Record<string, unknown>;
	files: Record<string, string>;
	focus?: string;
	solution?: Record<string, string>;
}) {
	lesson = { data: options.data };
	seededFiles = options.files;
	seededSolution = options.solution;
	lessonFullyLoaded.set(true);
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
	seededFiles = {};
	seededSolution = undefined;
	lessonFullyLoaded.set(true);
	documents.set({});
	currentDocument.set(undefined);
}
