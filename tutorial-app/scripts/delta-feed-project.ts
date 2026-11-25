/**
 * Project a Delta thread into a ReplayRecording for the homepage feed.
 *
 *   delta thread watch <thread> > thread.jsonl   # raw records: keep out of the repo
 *   npm run feed:project -- thread.jsonl src/feed/<slug>.approved.json
 *   npm run feed:project -- - src/feed/homepage.approved.json   # scripted items only
 *
 * Only items listed in the approved file are published. Agent thoughts are
 * never published, even if listed, and tool calls keep only their title.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { validateReplayRecording, type ReplayFrame, type ReplayRecording } from '../src/lib/acpReplayContract';

type DeltaItem = {
  id: string;
  kind: string;
  created_at?: number;
  author?: { name?: string | null };
  content: { text?: string; title?: string; status?: string; toolCallId?: string };
};

type Approved = {
  thread: string;
  recordingId: string;
  runId: string;
  speakers?: Record<string, string>;
  items: Array<
    | { id: string; text?: string; speaker?: string }
    | { script: { actor: 'client' | 'agent'; speaker: string; text: string; beside?: boolean; under?: boolean; source?: string } }
  >;
};

const PUBLISHABLE = new Set(['user_message', 'agent_message', 'tool_call']);

export function projectDeltaThread(jsonl: string, approved: Approved): ReplayRecording {
  const byId = new Map<string, DeltaItem>();
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as { type?: string; item?: DeltaItem };
    if (record.type === 'item' && record.item) byId.set(record.item.id, record.item);
  }

  const frames: ReplayFrame[] = approved.items.map((entry, order) => {
    if ('script' in entry) {
      const { actor, speaker, text, beside, under, source } = entry.script;
      // `beside`/`under`: in the same step as the previous frame, next to it or below it.
      // `source`: where the excerpt comes from; a visible link, and swipe left follows it.
      const meta = { ...(beside ? { beside: true } : {}), ...(under ? { under: true } : {}), ...(source ? { source } : {}) };
      const _meta = Object.keys(meta).length ? meta : undefined;
      return {
        frameId: `f${order + 1}`,
        order,
        actor,
        speaker,
        action: actor === 'client' ? 'user_message' : 'agent_message',
        envelope: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: approved.thread, update: { sessionUpdate: actor === 'client' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text }, ...(_meta ? { _meta } : {}) } } },
        provenance: { recordingId: approved.recordingId, kind: 'scripted', scriptId: `${approved.recordingId}/${order + 1}`, disclosure: 'homepage script' },
      };
    }
    const item = byId.get(entry.id);
    if (!item) throw new Error(`approved item ${entry.id} is not in the thread capture`);
    if (!PUBLISHABLE.has(item.kind)) throw new Error(`approved item ${entry.id} is a ${item.kind}, which is never published`);

    const isUser = item.kind === 'user_message';
    const author = item.author?.name ?? '';
    const speaker = entry.speaker ?? approved.speakers?.[author] ?? (isUser ? author : 'Agent');
    const update = item.kind === 'tool_call'
      ? { sessionUpdate: 'tool_call', toolCallId: item.content.toolCallId, title: entry.text ?? item.content.title, status: item.content.status }
      : { sessionUpdate: isUser ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: entry.text ?? item.content.text ?? '' } };

    return {
      frameId: `f${order + 1}`,
      order,
      actor: isUser ? 'client' : 'agent',
      speaker,
      action: item.kind,
      envelope: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: approved.thread, update } },
      provenance: {
        recordingId: approved.recordingId,
        kind: 'recorded',
        captureId: `${approved.thread}/${item.id}`,
        ...(item.created_at ? { capturedAt: new Date(item.created_at).toISOString() } : {}),
      },
    };
  });

  const recording: ReplayRecording = { recordingId: approved.recordingId, runId: approved.runId, frames, evaluations: [] };
  const invalid = validateReplayRecording(recording);
  if (invalid) throw new Error(invalid.reason);
  return recording;
}

if (process.argv[1]?.endsWith('delta-feed-project.ts')) {
  const [capture, approvedPath] = process.argv.slice(2);
  if (!capture || !approvedPath) throw new Error('usage: delta-feed-project <thread.jsonl | -> <slug.approved.json>');
  const recording = projectDeltaThread(capture === '-' ? '' : readFileSync(capture, 'utf8'), JSON.parse(readFileSync(approvedPath, 'utf8')));
  const out = approvedPath.replace(/\.approved\.json$/, '.recording.json');
  writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`wrote ${out}: ${recording.frames.length} frames`);
}
