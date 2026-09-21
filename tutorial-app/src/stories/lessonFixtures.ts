import { load } from 'js-yaml';
import {
	buildRuleTraceState,
	parseRuleTraceRuntime,
	resolveRuleTraceConfig,
} from '../lib/ruleTraceProtocol';
import {
	parseLoanwordRuntime,
	resolveLoanwordArcConfig,
	validateLoanwordLesson,
} from '../lib/loanwordArcProtocol';

// A lesson as TutorialKit loads it: frontmatter, starter `_files`, and the
// `_solution` files that Solve writes over them. Read straight from
// src/content, so stories exercise the lesson's own data, not copies of it.
const raw = import.meta.glob(
	[
		'../content/tutorial/part-1/chapter-1/lesson-1/{content.mdx,_files/*,_solution/*}',
		'../content/tutorial/part-1/chapter-2/lesson-1/{content.mdx,_files/*,_solution/*}',
	],
	{ eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;

export type Lesson = {
	// Frontmatter, i.e. what TutorialKit exposes as `lesson.data`.
	data: Record<string, unknown>;
	// Starter files, keyed by container path (`/exercise.de`).
	files: Record<string, string>;
	// Files after Solve: starter files with `_solution` written over them.
	solved: Record<string, string>;
	focus: string;
};

export function loadLesson(dir: 'part-1/chapter-1/lesson-1' | 'part-1/chapter-2/lesson-1'): Lesson {
	const base = `../content/tutorial/${dir}/`;
	const collect = (folder: string) =>
		Object.fromEntries(
			Object.entries(raw)
				.filter(([path]) => path.startsWith(`${base}${folder}/`))
				.map(([path, text]) => [`/${path.slice(base.length + folder.length + 1)}`, text]),
		);

	const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw[`${base}content.mdx`] ?? '');
	if (!frontmatter) throw new Error(`no frontmatter in ${dir}/content.mdx`);
	const data = load(frontmatter[1]) as Record<string, unknown>;
	const files = collect('_files');

	return { data, files, solved: { ...files, ...collect('_solution') }, focus: String(data.focus) };
}

// The lesson's own derivation, called the way its bridge calls it: the
// protocol library over the lesson's files, with config from its frontmatter.
export function deriveRuleTraceState(lesson: Lesson, files: Record<string, string>) {
	const config = resolveRuleTraceConfig(lesson.data.custom);
	if (!config) throw new Error('lesson has no custom.ruleTrace');

	return buildRuleTraceState({
		revision: 1,
		runtime: parseRuleTraceRuntime(files[config.runtimeFile]),
		scenario: config.scenario,
		storyFile: config.storyFile,
		text: files[config.commandFile] ?? '',
	});
}

export async function deriveLoanwordState(lesson: Lesson, files: Record<string, string>) {
	const config = resolveLoanwordArcConfig(lesson.data.custom);
	if (!config) throw new Error('lesson has no custom.loanwordArc');
	const runtime = parseLoanwordRuntime(files[config.runtimeFile]);

	const result = await validateLoanwordLesson({
		lessonId: config.lessonId,
		runtime,
		translationFile: config.translationFile,
		translationText: files[config.translationFile] ?? '',
		vocabularyFile: config.vocabularyFile,
		vocabularyText: config.vocabularyFile ? (files[config.vocabularyFile] ?? '') : '',
	});

	return {
		...result,
		revision: 1,
		scenario: config.scenario || runtime.scenario,
		storyFile: config.storyFile,
	};
}
