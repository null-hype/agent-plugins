import { useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import EvidenceInspector from '../components/EvidenceInspector';
import type { ArtifactRef, RecordedEvaluation, ReplaySnapshot } from '../lib/acpReplayContract';
import { AcpReplayController } from '../lib/acpReplayController';
import { parseAcpTraceFixture } from '../lib/acpTraceProtocol';
import { BundleArtifactResolver, type EvidenceBundle } from '../lib/evidenceArtifactResolver';
import { createFollowerMazeReplayRecording } from '../lib/followerMazeReplay';
import { loadLesson } from './lessonFixtures';
import bundleJson from '../../evidence/ghost-trace-v1/artifact-bundle.json';

// The same real capture and producer adapter the Recorded Run Debugger uses
// (CIT-300): refs are emitted by followerMazeReplay.ts, bytes come from the
// committed bundle built from evidence/ghost-trace-v1.
const bundle = bundleJson as EvidenceBundle;
const resolver = new BundleArtifactResolver(bundle);
const lesson2 = loadLesson('part-2/chapter-1/lesson-2');
const recording = createFollowerMazeReplayRecording(parseAcpTraceFixture(lesson2.solved['/acp-trace.json']).frames);
const failureEvaluationId = 'followerMaze.orderedRouting:arrival-4231:arrival-order';
const failureEvaluation = recording.evaluations.find(({ evaluationId }) => evaluationId === failureEvaluationId)!;

/** Opens the inspector over a controller parked at the failure breakpoint with the evaluation selected. */
function InspectorAtFailure({ evaluation }: { evaluation?: RecordedEvaluation }) {
  const controller = useMemo(() => {
    const instance = new AcpReplayController(recording);
    instance.seekBreakpoint('failure-result');
    instance.select({ kind: 'evaluation', evaluationId: failureEvaluationId });
    return instance;
  }, []);
  const [state, setState] = useState(() => controller.getState());
  useEffect(() => controller.subscribe(setState), [controller]);
  const snapshot = state as ReplaySnapshot;
  const shown = evaluation ?? snapshot.evaluations.find(({ evaluationId }) => evaluationId === failureEvaluationId)!;
  return (
    <>
      <EvidenceInspector evaluation={shown} resolver={resolver} cursor={snapshot.location.cursor} />
      <output aria-label="Playback state" style={{ display: 'block', marginTop: 8, font: '11px monospace' }}>
        cursor={snapshot.location.cursor.kind === 'frame' ? snapshot.location.cursor.frameId : 'before-first'} selection={JSON.stringify(snapshot.selection)} evidence={snapshot.availableEvidence.map(({ evidenceId }) => evidenceId).join(',')}
      </output>
    </>
  );
}

const meta = { title: 'Debugger/Captured Evidence Inspector', component: InspectorAtFailure, parameters: { layout: 'padded' } } satisfies Meta<typeof InspectorAtFailure>;
export default meta;
type Story = StoryObj<typeof meta>;

const playbackBefore = 'cursor=failure selection={"kind":"evaluation","evaluationId":"followerMaze.orderedRouting:arrival-4231:arrival-order"} evidence=arrival-order-rule,arrival-order-observation';

export const NavigateCapturedEvidence: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('opens the exact captured rule at its pinned revision and range', async () => {
      await expect(await canvas.findByText(/export function check\(/)).toBeVisible();
      await expect(canvas.getByText(/revision:be95c86ea1fddd8913cab7577f2405c1a2e90205/, { selector: 'code' })).toBeVisible();
      await expect(canvas.getByText('lines 279–334')).toBeVisible();
      await expect(canvas.getByText(failureEvaluationId)).toBeVisible();
    });
    await step('opens the wire-transcript observation at record 6, bytes and direction prefix intact', async () => {
      await userEvent.click(canvas.getByRole('button', { name: /wire-transcript/ }));
      await expect(await canvas.findByText('record 6 · result._meta.diagnostic.related[1]')).toBeVisible();
      const highlighted = canvasElement.querySelectorAll('.evidence-inspector pre .highlight');
      await expect(highlighted).toHaveLength(1);
      await expect(highlighted[0].textContent).toMatch(/^6agent->client \{"jsonrpc":"2\.0","id":2,"result":\{"stopReason":"end_turn"/);
      await expect(canvas.getByText(/capture:ghost-trace-v1/, { selector: 'code' })).toBeVisible();
    });
    await step('leaves playback and evaluation selection untouched', async () => {
      await expect(canvas.getByLabelText('Playback state')).toHaveTextContent(playbackBefore, { normalizeWhitespace: true });
    });
  },
};

export const SummaryOnlyLegacyEvidence: Story = {
  args: {
    // Synthetic by design: the real recording has no summary-only evidence, so this
    // models an older diagnostic that retained prose but never captured bytes.
    evaluation: {
      ...failureEvaluation,
      evidence: [...failureEvaluation.evidence, { evidenceId: 'grant-summary', availableAt: 'failure', role: 'related', contentKind: 'recorded-review-prose', availability: { status: 'missing', reason: 'the legacy diagnostic retained grant summary text but did not capture its bytes' } }],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /grant-summary/ }));
    await expect(canvas.getByText(/legacy diagnostic retained grant summary text/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: /grant-summary/ })).toHaveTextContent('summary only · no captured bytes');
  },
};

const withIdentity = (identity: ArtifactRef['identity']): RecordedEvaluation => ({
  ...failureEvaluation,
  evidence: failureEvaluation.evidence.map((evidence) => (
    evidence.availability.status === 'captured' ? { ...evidence, availability: { status: 'captured' as const, artifact: { ...evidence.availability.artifact, identity } } } : evidence
  )),
});

export const RevisionMismatch: Story = {
  args: { evaluation: withIdentity({ kind: 'revision', revision: 'be95c86' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Identity mismatch: bundle has revision:be95c86ea1fddd8913cab7577f2405c1a2e90205; requested revision:be95c86\./)).toBeVisible();
    await expect(canvasElement.querySelector('.evidence-inspector pre')).toBeNull();
  },
};

export const MissingCapturedArtifact: Story = {
  args: {
    evaluation: {
      ...failureEvaluation,
      evidence: failureEvaluation.evidence.map((evidence) => (
        evidence.availability.status === 'captured' ? { ...evidence, availability: { status: 'captured' as const, artifact: { ...evidence.availability.artifact, artifactId: 'never-captured' } } } : evidence
      )),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/captured artifact was not found in this bundle/)).toBeVisible();
  },
};
