import React, { useMemo, useState } from 'react';
import OtelWarmLogPreview from '../../stories/OtelWarmLogPreview';
import FollowerMazeStatus from './FollowerMazeStatus';
import { Channels } from './FollowerMazeChannels';
import { RepairRow } from './FollowerMazeBoardState';
import {
	boardFor,
	reduceLesson,
	type LessonAction,
} from './followerMazeLog';
import { WITNESS_MODELS, type WitnessModelId } from './followerMaze';


import { emptySnapshot, type WorkbenchSnapshot } from './scenarios';
export default function Workbench({ model = 'arrival-order', height = 1100, initial = emptySnapshot(), onChange }: {
 model?: WitnessModelId; height?: number; initial?: WorkbenchSnapshot; onChange?: (snapshot: WorkbenchSnapshot) => void;
}) {
	const [snapshot, setSnapshot] = useState(initial);
 const state = snapshot.lesson;
 const publish = (next: WorkbenchSnapshot) => { setSnapshot(next); onChange?.(next); };
 const dispatch = (action: LessonAction) => publish({ ...snapshot, lesson: reduceLesson(state, action), evidenceLine: null });
	const [choice, setChoice] = useState<WitnessModelId>(initial.lesson.witness ?? model);
	const board = useMemo(() => boardFor(state), [state]);
	const act = (action: LessonAction) => () => dispatch(action);
	// The repair the lesson can actually offer: swap the model, then rerun the
	// same family in place (solve keeps the arrival orderings; evaluate reruns them).
	const switchModel = (next: WitnessModelId) => {
		setChoice(next);
		publish({ lesson: reduceLesson(reduceLesson(state, { type: 'solve', model: next }), { type: 'evaluate' }), evidenceLine: null });
	};
	return (
		<div data-testid="follower-maze-workbench" data-snapshot={JSON.stringify(snapshot)}>
			<div role="toolbar" aria-label="lesson actions" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
				<label>
					Witness model{' '}
					<select value={choice} onChange={(event) => setChoice(event.target.value as WitnessModelId)}>
						{Object.keys(WITNESS_MODELS).map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</select>
				</label>
				<button onClick={act({ type: 'solve', model: choice })}>Send events to the implementation</button>
				<button onClick={act({ type: 'evaluate' })}>Evaluate</button>
				<button onClick={act({ type: 'transform' })}>Transform arrival order</button>
			</div>
			<FollowerMazeStatus board={board} />
			<Channels board={board} onSelect={(name) => dispatch({ type: 'select', name })}>
				<OtelWarmLogPreview records={board.records} evidenceLine={snapshot.evidenceLine} onEvidence={(evidenceLine) => publish({ ...snapshot, evidenceLine })} editable={board.editable} onEdit={(text) => dispatch({ type: 'write', text })} height={height} />
			</Channels>
			<RepairRow board={board} witness={state.witness} onSwitchModel={switchModel} />
		</div>
	);
}
