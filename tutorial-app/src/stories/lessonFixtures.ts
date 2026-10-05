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
import {
	type AcpTraceConfig,
	buildAcpTraceState,
	frameFilePath,
	parseAcpTraceFixtureRef,
	resolveAcpTraceConfig,
	resolveAcpTraceFixture,
} from '../lib/acpTraceProtocol';

// A lesson as TutorialKit loads it: frontmatter, starter `_files`, and the
// `_solution` files that Solve writes over them. Read straight from
// src/content, so stories exercise the lesson's own data, not copies of it.
// Every lesson is globbed, so a newly generated one needs no edit here.
const raw = import.meta.glob('../content/tutorial/**/{content.mdx,_files/**,_solution/**}', {
	eager: true,
	query: '?raw',
	import: 'default',
}) as Record<string, string>;

const ROOT = '../content/tutorial/';

export type Lesson = {
	// Frontmatter, i.e. what TutorialKit exposes as `lesson.data`.
	data: Record<string, unknown>;
	// Starter files, keyed by container path (`/exercise.de`).
	files: Record<string, string>;
	// Files after Solve: starter files with `_solution` written over them.
	solved: Record<string, string>;
	focus: string;
	// The MDX after the frontmatter: the lesson's imports, bridge and prose.
	body: string;
};

/** `dir` is the lesson's directory under src/content/tutorial, e.g. `part-2/chapter-1/lesson-1`. */
export function loadLesson(dir: string): Lesson {
	const base = `${ROOT}${dir}/`;
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

	return { data, files, solved: { ...files, ...collect('_solution') }, focus: String(data.focus), body: raw[`${base}content.mdx`].slice(frontmatter[0].length) };
}

/** Every lesson directory under src/content/tutorial, in TutorialKit's order (part, chapter, lesson). */
export function lessonDirs(): string[] {
	return Object.keys(raw)
		.filter((path) => path.endsWith('/content.mdx'))
		.map((path) => path.slice(ROOT.length, -'/content.mdx'.length))
		.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
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

// `config` stands in for frontmatter when a lesson passes traceFile/scenario
// to AcpTraceBridge as props instead (part 3's compiled lessons do).
export function deriveAcpTraceState(
	lesson: Lesson,
	files: Record<string, string>,
	options?: { frameId?: string; config?: AcpTraceConfig },
) {
	const config = options?.config ?? resolveAcpTraceConfig(lesson.data.custom);
	if (!config) throw new Error('lesson has no custom.acpTrace');

	const ref = parseAcpTraceFixtureRef(files[config.traceFile]);
	const loadFrame = (frameId: string) => files[frameFilePath(config.traceFile, frameId)];

	return buildAcpTraceState({
		revision: 1,
		fixture: resolveAcpTraceFixture(ref, loadFrame, options),
		scenario: config.scenario,
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

// Markdown a lesson imports as a component (`import LessonCopy from '.../x.md'`).
const imported = import.meta.glob('../lesson-copy/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const BRIDGE = /<AcpTraceBridge\b([^>]*)\/>/;
const attribute = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

/** The trace config the lesson's AcpTraceBridge runs with: frontmatter, else its props, else the bridge's defaults. */
export function acpTraceConfig(lesson: Lesson): AcpTraceConfig | null {
	if (lesson.data.template !== 'acp-trace') return null;
	const custom = resolveAcpTraceConfig(lesson.data.custom);
	if (custom) return custom;
	const attrs = BRIDGE.exec(lesson.body)?.[1] ?? '';
	return {
		traceFile: attribute(attrs, 'traceFile') ?? '/acp-trace.json',
		scenario: attribute(attrs, 'scenario') ?? 'ghost-trace-diagnostic-v1',
	};
}

/** The lesson's prose as TutorialKit renders it: imports dropped, imported Markdown inlined, the headless bridge removed. */
export function lessonProse(lesson: Lesson): string {
	const components = new Map<string, string>();
	const lines = lesson.body.split('\n').filter((line) => {
		const match = /^import\s+(\w+)\s+from\s+['"](.+)['"];?\s*$/.exec(line);
		if (!match) return true;
		const copy = /lesson-copy\/([^/]+\.md)$/.exec(match[2]);
		if (copy) components.set(match[1], imported[`../lesson-copy/${copy[1]}`] ?? '');
		return false;
	});
	return lines
		.join('\n')
		.replace(BRIDGE, '')
		.replace(/<(\w+)\s*\/>/g, (tag, name: string) => components.get(name) ?? tag)
		.trim();
}
