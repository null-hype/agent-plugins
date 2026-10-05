import { Markdown } from '@storybook/addon-docs/blocks';
import { ThemeProvider, convert, themes } from 'storybook/theming';
import { resolveAcpTraceConfig, type AcpTraceConfig } from '../lib/acpTraceProtocol';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';

// One viewer for any acp-trace lesson in src/content: the lesson's own prose
// above the Client/Agent previews, fed from its own `_files` (or, solved, its
// `_solution`). Nothing here is specific to a lesson, so a lesson the reporter
// generates shows up without a story or docs page of its own.

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

type Props = { lesson: Lesson; solved?: boolean; frameId?: string; height?: number };

export default function LessonViewer({ lesson, solved = false, frameId, height = 640 }: Props) {
	const config = acpTraceConfig(lesson);
	if (!config) throw new Error(`not an acp-trace lesson: ${String(lesson.data.title)}`);
	return (
		<div style={{ display: 'grid', gap: 16 }}>
			{/* TutorialKit shows the title in its navigation, apart from the prose. */}
			<header style={{ fontSize: 12, fontWeight: 700, color: '#6b6658' }}>{String(lesson.data.title)}</header>
			<article style={{ maxWidth: 760, lineHeight: 1.5 }}>
				{/* The docs Markdown block reads Storybook's theme, which a story canvas does not provide. */}
				<ThemeProvider theme={convert(themes.light)}>
					<Markdown>{lessonProse(lesson)}</Markdown>
				</ThemeProvider>
			</article>
			<AcpTracePreview
				payload={deriveAcpTraceState(lesson, solved || frameId ? lesson.solved : lesson.files, { config, frameId: frameId || undefined })}
				height={height}
			/>
		</div>
	);
}
