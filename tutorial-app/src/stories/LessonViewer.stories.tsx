import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { editorsReady } from './acpTracePlay';
import { Markdown } from '@storybook/addon-docs/blocks';
import { ThemeProvider, convert, themes } from 'storybook/theming';
import { acpTraceConfig, lessonDirs, lessonProse, loadLesson } from './lessonFixtures';
import LessonViewer from './LessonViewer';

// The generic lesson viewer: every acp-trace lesson in src/content, picked
// from the `lesson` control. Lessons are read as generated (frontmatter,
// `content.mdx`, `_files`, `_solution`), so a new lesson needs a run, not a
// story. The prose is TutorialKit's own copy, rendered here with Storybook's
// Markdown block; the viewer component holds none of it.

// Keyed by directory with `/` as `_`: Storybook only takes URL args made of
// letters, digits, spaces, `-` and `_`, so `?args=lesson:part-5_…` can link one.
const lessons = new Map(
	lessonDirs()
		.map((dir) => [dir.replaceAll('/', '_'), loadLesson(dir)] as const)
		.filter(([, lesson]) => acpTraceConfig(lesson)),
);
const keys = [...lessons.keys()];

type Args = { lesson: string; solved: boolean; frameId: string };

const meta: Meta<Args> = {
	title: 'Lessons/Viewer',
	parameters: { layout: 'padded', docs: { story: { autoplay: false } } },
	argTypes: {
		lesson: {
			control: 'select',
			options: keys,
			labels: Object.fromEntries(keys.map((key) => [key, `${key.split('_')[0]} · ${String(lessons.get(key)!.data.title)}`])),
			description: 'A lesson under src/content/tutorial (its directory, with `/` as `_`).',
		},
		solved: { control: 'boolean', description: 'Show the state TutorialKit’s Solve reaches.' },
		frameId: { control: 'text', description: 'Open one recorded frame (with its neighbours), for lessons split into frame files.' },
	},
	args: { lesson: keys[0], solved: false, frameId: '' },
	render: ({ lesson, solved, frameId }) => (
		<div style={{ display: 'grid', gap: 16 }}>
			{/* TutorialKit shows the title in its navigation, apart from the prose. */}
			<header style={{ fontSize: 12, fontWeight: 700, color: '#6b6658' }}>{String(lessons.get(lesson)!.data.title)}</header>
			<article style={{ maxWidth: 760, lineHeight: 1.5 }}>
				{/* The docs Markdown block reads Storybook's theme, which a story canvas does not provide. */}
				<ThemeProvider theme={convert(themes.light)}>
					<Markdown>{lessonProse(lessons.get(lesson)!)}</Markdown>
				</ThemeProvider>
			</article>
			<LessonViewer key={lesson} lesson={lessons.get(lesson)!} solved={solved} frameId={frameId} />
		</div>
	),
	play: async ({ canvasElement, args }) => {
		await editorsReady(canvasElement);
		await waitFor(() => {
			expect(canvasElement.querySelector('header')?.textContent).toBe(String(lessons.get(args.lesson)!.data.title));
			expect(canvasElement.querySelector('article')?.textContent?.trim()).toBeTruthy();
		});
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Lesson: Story = {};

export const Solved: Story = { args: { solved: true } };
