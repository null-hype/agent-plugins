import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import EvidenceInspector from '../components/EvidenceInspector';
import type { RecordedEvaluation } from '../lib/acpReplayContract';
import { BundleArtifactResolver, type EvidenceBundle } from '../lib/evidenceArtifactResolver';
import bundleJson from '../../evidence/ghost-trace-v1/artifact-bundle.json';

const bundle = bundleJson as EvidenceBundle;
const resolver = new BundleArtifactResolver(bundle);
const diagnostic = {
  code: 'fm-missing-delivery', severity: 'error' as const,
  message: 'required delivery 10 <- seq 2 is absent from the captured witness',
  subject: { role: 'fact' as const, uri: 'fixtures/arrivals/4231.json', detail: 'arrival [4,2,3,1]' },
  related: [], evaluationId: 'followerMaze.orderedRouting:arrival-4231',
};
const evaluation: RecordedEvaluation = {
  evaluationId: 'followerMaze.orderedRouting:arrival-4231:arrival-order', sourceEvaluationId: diagnostic.evaluationId,
  frameId: 'failure', diagnostic, verdicts: [], provenance: { kind: 'recorded', captureId: 'ghost-trace-v1' },
  evidence: [
    {
      evidenceId: 'subject', availableAt: 'failure', role: 'subject', contentKind: 'source',
      availability: { status: 'captured', artifact: {
        artifactId: 'arrival-source-be95c86', recordingId: 'ghost-trace-v1', runId: 'arrival-4231', frameId: 'failure',
        path: 'fixtures/arrivals/4231.json', identity: { kind: 'revision', revision: 'be95c86' },
        location: { kind: 'source-range', startLine: 3, endLine: 3 },
      } },
    },
    {
      evidenceId: 'observation', availableAt: 'failure', role: 'related', contentKind: 'captured-execution-output',
      availability: { status: 'captured', artifact: {
        artifactId: 'failure-observation', recordingId: 'ghost-trace-v1', runId: 'arrival-4231', frameId: 'failure',
        path: 'evidence/ghost-trace-v1/wire-transcript.jsonl', identity: { kind: 'capture', captureId: 'ghost-trace-v1' },
        location: { kind: 'record', record: 2, field: 'result._meta.diagnostic' },
      } },
    },
    { evidenceId: 'grant-summary', availableAt: 'failure', role: 'related', contentKind: 'recorded-review-prose', availability: { status: 'missing', reason: 'the legacy diagnostic retained grant summary text but did not capture its bytes' } },
  ],
};

const meta = { title: 'Debugger/Captured Evidence Inspector', component: EvidenceInspector, args: { evaluation, resolver, cursor: { kind: 'frame', frameId: 'failure' } }, parameters: { layout: 'padded' } } satisfies Meta<typeof EvidenceInspector>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NavigateCapturedEvidence: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    await step('opens exact source bytes and retains evaluation and cursor identity', async () => {
      await expect(await canvas.findByText(/"4\|S\|20"/)).toBeVisible();
      await expect(canvas.getByText(/followerMaze\.orderedRouting:arrival-4231:arrival-order/)).toBeVisible();
      await expect(canvas.getByText(/cursor/)).toHaveTextContent('failure');
    });
    await step('navigates to the structured observation without changing playback', async () => {
      await userEvent.click(canvas.getByRole('button', { name: /wire-transcript/ }));
      await expect(await canvas.findByText(/fm-missing-delivery/)).toBeVisible();
      await expect(canvas.getByText(/cursor/)).toHaveTextContent('failure');
    });
    await step('labels summary-only legacy evidence honestly', async () => {
      await userEvent.click(canvas.getByRole('button', { name: /grant-summary/ }));
      await expect(canvas.getByText(/legacy diagnostic retained grant summary text/)).toBeVisible();
    });
  },
};

export const IdentityMismatch: Story = {
  args: {
    evaluation: {
      ...evaluation,
      evidence: [{
        ...evaluation.evidence[0],
        availability: {
          status: 'captured',
          artifact: {
            artifactId: 'arrival-source-be95c86', recordingId: 'ghost-trace-v1', runId: 'arrival-4231', frameId: 'failure',
            path: 'fixtures/arrivals/4231.json', identity: { kind: 'revision', revision: 'wrong-revision' },
            location: { kind: 'source-range', startLine: 3, endLine: 3 },
          },
        },
      }],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Identity mismatch/)).toBeVisible();
  },
};
