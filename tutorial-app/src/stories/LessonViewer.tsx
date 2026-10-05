import AcpTracePreview from './AcpTracePreview';
import { acpTraceConfig, deriveAcpTraceState, type Lesson } from './lessonFixtures';

// One viewer for any acp-trace lesson in src/content: the Client/Agent
// previews, fed from the lesson's own `_files` (or, solved, its `_solution`).
// It holds no lesson text; the story renders the lesson's prose beside it.

type Props = { lesson: Lesson; solved?: boolean; frameId?: string; height?: number };

export default function LessonViewer({ lesson, solved = false, frameId, height = 640 }: Props) {
	const config = acpTraceConfig(lesson);
	if (!config) throw new Error(`not an acp-trace lesson: ${String(lesson.data.title)}`);
	return (
		<AcpTracePreview
			payload={deriveAcpTraceState(lesson, solved || frameId ? lesson.solved : lesson.files, { config, frameId: frameId || undefined })}
			height={height}
		/>
	);
}
