import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AcpTracePreview from './AcpTracePreview';
import { deriveAcpTraceState, type Lesson } from './lessonFixtures';
import type { PklLocation, SharedModel } from '../../.storybook/shared-model';

// Unlike the replays, this runs something: each person's working copy of the
// shared model is evaluated by Pkl (the `pkl` on PATH) on every
// save. The review the Client shows is built from that evaluation in the same
// shape a recorded reply has, so the lens and Peek are the replay's own.
const meta = {
  title: 'Shared model',
  parameters: { layout: 'padded', controls: { include: ['user'] } },
  argTypes: { user: { control: 'text' } },
  args: { user: 'alice' },
} satisfies Meta<{ user: string }>;
export default meta;
type Story = StoryObj<typeof meta>;

const file = 'PrivateDocument.pkl';
const scenario = 'cit294-review-v1';
const fixture = { data: {}, files: {}, solved: {}, focus: '' } satisfies Lesson;

/** The question each member of the model answers. */
const questions: Record<string, string> = {
  aliceReads: "Can Alice read Bob's private document?",
  bobReads: 'Can Bob read it?',
};

const lineOf = (text: string, member: string) => text.split('\n').findIndex((line) => line.startsWith(`${member}:`)) + 1;

function probe(model: SharedModel, member: string) {
  const { user, evaluation } = model;
  const working = (role: string, at: { line: number; column?: number; endColumn?: number }, detail: string) =>
    ({ role, uri: file, revision: user, editable: true, ...at, detail });
  const diagnostic = (severity: string, code: string, text: string, related: unknown[]) =>
    ({ severity, code, message: `${code}: ${text}`, evaluationId: `shared-model:${user}:${member}:${code}`, related });

  if (evaluation.ok) {
    const value = (evaluation.value as Record<string, unknown>)[member];
    return diagnostic('info', 'pkl.evaluated', `${member} = ${value}; Pkl accepts it against its type.`,
      [working('model', { line: lineOf(model.working, member) }, `${member} as ${user} holds it.`)]);
  }
  const here = evaluation.locations.filter((location: PklLocation) => location.member === member);
  if (!here.length) {
    return diagnostic('info', 'pkl.unevaluated', `the model does not evaluate, so ${member} has no value.`,
      [working('model', { line: lineOf(model.working, member) }, `${member} as ${user} holds it.`)]);
  }
  const code = evaluation.message.startsWith('Type constraint') ? 'pkl.constraint' : 'pkl.error';
  return diagnostic('error', code, evaluation.message, [
    ...here.map((location, index) => working(index === 0 && here.length > 1 ? 'constraint' : 'value', location,
      `Where Pkl's error points, in ${user}'s working copy.`)),
    { role: 'value', uri: file, revision: 'base', line: lineOf(model.base, member), detail: `${member} as committed.` },
  ]);
}

function trace(model: SharedModel) {
  const probes = Object.keys(questions).map((member) => ({
    question: questions[member],
    action: `evaluate ${file}`,
    diagnostic: probe(model, member),
  }));
  return {
    scenario,
    frames: [
      {
        actor: 'client',
        action: 'send prompt',
        envelope: { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: `shared-model-${model.user}`,
          prompt: [{ type: 'text', text: `Is the private document private?\n\nThe shared model, ${file}, as ${model.user} holds it.` }] } },
        provenance: { recordingId: `shared-model:${model.user}`, scripted: 'Framing for a live evaluation.' },
      },
      {
        actor: 'agent',
        action: 'evaluate the model',
        speaker: 'pkl',
        envelope: { jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn', _meta: { diagnostic: probes[0].diagnostic, probes } } },
        provenance: { recordingId: `shared-model:${model.user}:pkl`, scripted: 'Built from Pkl evaluating the working copy.' },
      },
    ],
    nextTurn: null,
  };
}

function SharedModelReview({ user }: { user: string }) {
  const [model, setModel] = useState<SharedModel | null>(null);
  useEffect(() => {
    fetch(`/__shared-model?user=${encodeURIComponent(user)}`).then((r) => r.json()).then(setModel);
  }, [user]);
  const onSaved = useCallback(({ revision, text }: { revision: string; text: string }) => {
    if (revision !== user) return;
    fetch(`/__shared-model?user=${encodeURIComponent(user)}`, { method: 'PUT', body: text }).then((r) => r.json()).then(setModel);
  }, [user]);
  const payload = useMemo(() => model && {
    ...deriveAcpTraceState(fixture, { '/acp-trace.json': JSON.stringify(trace(model)) }, { config: { traceFile: '/acp-trace.json', scenario } }),
    evidenceFiles: { [`${file}@${model.user}`]: model.working, [`${file}@base`]: model.base },
  }, [model]);
  if (!payload) return <p>Evaluating {file}…</p>;
  return <AcpTracePreview agent={false} payload={payload} height={640} onSaved={onSaved} />;
}

export const PrivateDocument: Story = {
  name: 'Private document',
  render: ({ user }) => <SharedModelReview user={user} />,
};
