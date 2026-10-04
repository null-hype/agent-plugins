import {
  deriveReplaySnapshot,
  validateReplayRecording,
  type ExplicitFailure,
  type LogViewport,
  type ReplayCursor,
  type ReplayLocation,
  type ReplayRecording,
  type ReplaySelection,
  type ReplaySnapshot,
} from './acpReplayContract';

export type ReplayControllerState = ReplaySnapshot | ExplicitFailure;
export type ReplayControllerListener = (state: ReplayControllerState) => void;

/**
 * The single state owner for recorded-run navigation. Every transition is
 * rebuilt from the recording's validated prefix; this controller never
 * invokes an agent and never attempts to undo an external effect.
 */
export class AcpReplayController {
  readonly recording: ReplayRecording;
  private location: ReplayLocation;
  private state: ReplayControllerState;
  private readonly listeners = new Set<ReplayControllerListener>();

  constructor(recording: ReplayRecording, initial?: Partial<Pick<ReplayLocation, 'cursor' | 'selection' | 'viewport'>>) {
    this.recording = recording;
    const first = recording.frames[0];
    this.location = {
      recordingId: recording.recordingId,
      runId: recording.runId,
      cursor: initial?.cursor ?? (first ? { kind: 'frame', frameId: first.frameId } : { kind: 'before-first' }),
      selection: initial?.selection ?? null,
      viewport: initial?.viewport ?? {},
    };
    this.state = validateReplayRecording(recording) ?? deriveReplaySnapshot(recording, this.location);
    this.adoptCanonicalLocation();
  }

  getState(): ReplayControllerState {
    return this.state;
  }

  subscribe(listener: ReplayControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stepForward(): ReplayControllerState {
    const index = this.cursorIndex();
    const next = this.recording.frames[index + 1];
    return next ? this.move({ kind: 'frame', frameId: next.frameId }) : this.state;
  }

  stepBack(): ReplayControllerState {
    const index = this.cursorIndex();
    if (index < 0) return this.state;
    const previous: ReplayCursor = index === 0
      ? { kind: 'before-first' }
      : { kind: 'frame', frameId: this.recording.frames[index - 1].frameId };
    return this.move(previous);
  }

  seek(frameId: string): ReplayControllerState {
    return this.move({ kind: 'frame', frameId });
  }

  seekBreakpoint(breakpointId: string): ReplayControllerState {
    const frame = this.recording.frames.find(({ breakpointIds }) => breakpointIds?.includes(breakpointId));
    if (!frame) return this.publish({ status: 'frame-not-found', frameId: breakpointId });
    return this.seek(frame.frameId);
  }

  /** Stops only at a frame with a recorded diagnostic/check evaluation. */
  continueToDiagnostic(): ReplayControllerState {
    const current = this.cursorIndex();
    const evaluationFrames = new Set(this.recording.evaluations.map(({ frameId }) => frameId));
    const next = this.recording.frames.find((frame, index) => index > current && evaluationFrames.has(frame.frameId));
    return next ? this.seek(next.frameId) : this.state;
  }

  reset(): ReplayControllerState {
    const first = this.recording.frames[0];
    this.location = {
      ...this.location,
      cursor: first ? { kind: 'frame', frameId: first.frameId } : { kind: 'before-first' },
      selection: null,
    };
    return this.rebuild();
  }

  select(selection: ReplaySelection): ReplayControllerState {
    this.location = { ...this.location, selection };
    return this.rebuild();
  }

  setViewport(viewport: LogViewport): ReplayControllerState {
    this.location = { ...this.location, viewport };
    return this.rebuild();
  }

  private cursorIndex(): number {
    const cursor = this.location.cursor;
    if (cursor.kind === 'before-first') return -1;
    return this.recording.frames.findIndex(({ frameId }) => frameId === cursor.frameId);
  }

  private move(cursor: ReplayCursor): ReplayControllerState {
    this.location = { ...this.location, cursor };
    return this.rebuild();
  }

  private rebuild(): ReplayControllerState {
    return this.publish(deriveReplaySnapshot(this.recording, this.location));
  }

  private publish(state: ReplayControllerState): ReplayControllerState {
    this.state = state;
    this.adoptCanonicalLocation();
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  private adoptCanonicalLocation() {
    if ('location' in this.state) this.location = this.state.location;
  }
}
