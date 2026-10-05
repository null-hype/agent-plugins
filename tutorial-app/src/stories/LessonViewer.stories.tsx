import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { editorsReady } from './acpTracePlay';
import { lessonDirs, loadLesson } from './lessonFixtures';
import LessonViewer, { acpTraceConfig } from './LessonViewer';

// The generic lesson viewer: every acp-trace lesson in src/content, picked
// from the `lesson` control. Lessons are read as generated (frontmatter,
// `_files`, `_solution`), so a new lesson needs a run, not a story.

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
	render: ({ lesson, solved, frameId }) => <LessonViewer key={lesson} lesson={lessons.get(lesson)!} solved={solved} frameId={frameId} />,
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
