import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef, ArtifactResolution, ReplaySnapshot } from './acpReplayContract';
import { AcpReplayController } from './acpReplayController';
import { parseAcpTraceFixture } from './acpTraceProtocol';
import { createFollowerMazeReplayRecording } from './followerMazeReplay';
import { BundleArtifactResolver, parseFieldPath, recordLineNumber, recordLines, type EvidenceBundle } from './evidenceArtifactResolver';

const bundle: EvidenceBundle = {
  format: 'governance-evidence-bundle/v1',
  artifacts: [
    { artifactId: 'old', recordingId: 'recording', runId: 'run-old', frameId: 'failure', path: 'same.ts', identity: { kind: 'revision', revision: 'aaa' }, content: 'export const answer = "old";\n' },
    { artifactId: 'new', recordingId: 'recording', runId: 'run-new', frameId: 'failure', path: 'same.ts', identity: { kind: 'revision', revision: 'bbb' }, content: 'export const answer = "new";\n' },
  ],
};
const ref = (overrides: Partial<ArtifactRef> = {}): ArtifactRef => ({
  artifactId: 'old', recordingId: 'recording', runId: 'run-old', frameId: 'failure', path: 'same.ts',
  identity: { kind: 'revision', revision: 'aaa' }, location: { kind: 'source-range', startLine: 1, startColumn: 23, endLine: 1, endColumn: 26 }, ...overrides,
});

describe('BundleArtifactResolver', () => {
  it('resolves exact captured bytes when the same path exists in different runs and revisions', async () => {
    const resolver = new BundleArtifactResolver(bundle);
    const old = await resolver.resolve(ref());
    const next = await resolver.resolve(ref({ artifactId: 'new', runId: 'run-new', identity: { kind: 'revision', revision: 'bbb' } }));
    expect(old.status === 'resolved' && new TextDecoder().decode(old.bytes)).toContain('"old"');
    expect(next.status === 'resolved' && new TextDecoder().decode(next.bytes)).toContain('"new"');
  });

  it('reports missing bytes, identity mismatches and invalid locations without fallback', async () => {
    const resolver = new BundleArtifactResolver(bundle);
    await expect(resolver.resolve(ref({ artifactId: 'absent' }))).resolves.toMatchObject({ status: 'artifact-not-found' });
    await expect(resolver.resolve(ref({ identity: { kind: 'revision', revision: 'bbb' } }))).resolves.toMatchObject({ status: 'artifact-identity-mismatch', actualIdentity: 'revision:aaa' });
    await expect(resolver.resolve(ref({ location: { kind: 'source-range', startLine: 9, endLine: 9 } }))).resolves.toMatchObject({ status: 'artifact-location-mismatch' });
  });

  it('validates structured-record fields before returning the complete capture', async () => {
    const jsonl: EvidenceBundle = { format: 'governance-evidence-bundle/v1', artifacts: [{ ...bundle.artifacts[0], content: '{"result":{"code":"fail"}}\n' }] };
    const resolver = new BundleArtifactResolver(jsonl);
    await expect(resolver.resolve(ref({ location: { kind: 'record', record: 1, field: 'result.code' } }))).resolves.toMatchObject({ status: 'resolved' });
    await expect(resolver.resolve(ref({ location: { kind: 'record', record: 1, field: 'result.missing' } }))).resolves.toMatchObject({ status: 'artifact-location-mismatch' });
  });
});

// ---------------------------------------------------------------------------
// CIT-253 repair: bind to the real producer references and captured bytes.
// ---------------------------------------------------------------------------
const evidenceDir = new URL('../../evidence/ghost-trace-v1/', import.meta.url);
const realBundle = JSON.parse(readFileSync(new URL('artifact-bundle.json', evidenceDir), 'utf8')) as EvidenceBundle;
const realTranscript = readFileSync(new URL('wire-transcript.jsonl', evidenceDir), 'utf8');
const realRule = readFileSync(new URL('followerMaze.ts', evidenceDir), 'utf8');
const lesson2Solution = new URL('../content/tutorial/part-2/chapter-1/lesson-2/_solution/acp-trace.json', import.meta.url);
const recording = createFollowerMazeReplayRecording(parseAcpTraceFixture(readFileSync(lesson2Solution, 'utf8')).frames);
const decode = (resolution: ArtifactResolution) => {
  if (resolution.status !== 'resolved') throw new Error(`expected resolved, got ${resolution.status}`);
  return new TextDecoder().decode(resolution.bytes);
};
const capturedRefs = recording.evaluations.flatMap(({ evidence }) => evidence)
  .flatMap(({ evidenceId, availability }) => availability.status === 'captured' ? [{ evidenceId, ref: availability.artifact }] : []);
const refFor = (evidenceId: string) => capturedRefs.find((entry) => entry.evidenceId === evidenceId)!.ref;

describe('BundleArtifactResolver against the real Follower Maze capture', () => {
  const resolver = new BundleArtifactResolver(realBundle);

  it('keeps the committed bundle byte-identical to the captured files it claims to hold', () => {
    const byId = (id: string, frameId: string) => realBundle.artifacts.find((a) => a.artifactId === id && a.frameId === frameId)!;
    expect(byId('arrival-order-observation', 'failure').content).toBe(realTranscript);
    expect(byId('reorder-buffer-observation', 'repair-pass').content).toBe(realTranscript);
    expect(byId('follower-maze-rule', 'failure').content).toBe(realRule);
    expect(byId('follower-maze-rule', 'repair-pass').content).toBe(realRule);
    // Original bytes, not a re-encoded rendering: the direction prefix survives.
    expect(realTranscript.split('\n')[5]).toMatch(/^agent->client \{"jsonrpc":"2\.0","id":2,"result":/);
  });

  it('resolves every captured reference the producer emits, and only from the bundle', async () => {
    expect(capturedRefs.map(({ evidenceId }) => evidenceId).sort()).toEqual([
      'arrival-order-observation', 'arrival-order-rule', 'reorder-buffer-observation', 'reorder-buffer-rule',
    ]);
    for (const { ref } of capturedRefs) expect(await resolver.resolve(ref)).toMatchObject({ status: 'resolved' });
  });

  it('opens the arrival-order observation at record 6, result._meta.diagnostic.related[1], with untouched bytes', async () => {
    const ref = refFor('arrival-order-observation');
    expect(ref).toMatchObject({
      artifactId: 'arrival-order-observation', frameId: 'failure', path: 'tutorial-app/evidence/ghost-trace-v1/wire-transcript.jsonl',
      location: { kind: 'record', record: 6, field: 'result._meta.diagnostic.related[1]' },
    });
    const text = decode(await resolver.resolve(ref));
    expect(text).toBe(realTranscript);
    // The located record is the failing diagnostic, and related[1] is the missing-delivery observation.
    const record = recordLines(text)[5];
    expect(record.startsWith('agent->client ')).toBe(true);
    const payload = JSON.parse(record.slice('agent->client '.length));
    expect(payload.result._meta.diagnostic.related[1]).toMatchObject({ role: 'observation', uri: 'witness/arrival-order' });
    expect(recordLineNumber(text, 6)).toBe(6);
  });

  it('opens the reorder-buffer observation at record 8 from the repair frame', async () => {
    expect(decode(await resolver.resolve(refFor('reorder-buffer-observation')))).toBe(realTranscript);
  });

  it('opens the governing rule at its pinned revision and line range', async () => {
    const text = decode(await resolver.resolve(refFor('arrival-order-rule')));
    expect(text).toBe(realRule);
    expect(text.split('\n')[278]).toContain('export function check(');
  });

  it('refuses an abbreviated or different revision instead of falling back', async () => {
    const ref = refFor('arrival-order-rule');
    for (const revision of ['be95c86', 'repaired-revision']) {
      await expect(resolver.resolve({ ...ref, identity: { kind: 'revision', revision } })).resolves.toMatchObject({
        status: 'artifact-identity-mismatch', actualIdentity: `revision:${(ref.identity as { revision: string }).revision}`,
      });
    }
    await expect(resolver.resolve({ ...ref, identity: { kind: 'capture', captureId: 'ghost-trace-v1' } })).resolves.toMatchObject({ status: 'artifact-identity-mismatch' });
  });

  it('does not hand a frame the bytes captured for another frame or run', async () => {
    const ref = refFor('arrival-order-observation');
    await expect(resolver.resolve({ ...ref, frameId: 'repair-pass' })).resolves.toMatchObject({ status: 'artifact-not-found' });
    await expect(resolver.resolve({ ...ref, runId: 'arrival-9999' })).resolves.toMatchObject({ status: 'artifact-not-found' });
    await expect(resolver.resolve({ ...ref, path: 'tutorial-app/evidence/ghost-trace-v1/arrival-4231.json' })).resolves.toMatchObject({ status: 'artifact-not-found' });
  });

  it('reports missing and malformed locations explicitly', async () => {
    const ref = refFor('arrival-order-observation');
    const at = (location: unknown) => resolver.resolve({ ...ref, location } as ArtifactRef);
    const mismatch = (reason: RegExp) => expect.objectContaining({ status: 'artifact-location-mismatch', reason: expect.stringMatching(reason) });
    await expect(at(undefined)).resolves.toEqual(mismatch(/no location/));
    await expect(at({ kind: 'frame' })).resolves.toEqual(mismatch(/unsupported location kind/));
    await expect(at({ kind: 'record', record: 9 })).resolves.toEqual(mismatch(/outside/));
    await expect(at({ kind: 'record', record: 0 })).resolves.toEqual(mismatch(/positive integer/));
    await expect(at({ kind: 'record', record: 6.5 })).resolves.toEqual(mismatch(/positive integer/));
    await expect(at({ kind: 'record', record: 6, field: 'result._meta.diagnostic.related[9]' })).resolves.toEqual(mismatch(/absent/));
    await expect(at({ kind: 'record', record: 6, field: 'result._meta.diagnostic.related.1' })).resolves.toEqual(mismatch(/absent/));
    await expect(at({ kind: 'record', record: 6, field: 'result._meta.diagnostic.related[x]' })).resolves.toEqual(mismatch(/malformed/));
    await expect(at({ kind: 'record', record: 6, field: 'result._meta.diagnostic.related[1' })).resolves.toEqual(mismatch(/malformed/));
    await expect(at({ kind: 'record', record: 6, field: 'result..code' })).resolves.toEqual(mismatch(/malformed/));
    await expect(at({ kind: 'record', record: 6, field: '' })).resolves.toEqual(mismatch(/empty/));
    await expect(at({ kind: 'record', record: 6, field: 'result.constructor' })).resolves.toEqual(mismatch(/absent/));
    await expect(at({ kind: 'source-range', startLine: Number.NaN, endLine: 3 })).resolves.toEqual(mismatch(/positive integers/));
    await expect(at({ kind: 'source-range', startLine: 3, endLine: 2 })).resolves.toEqual(mismatch(/ends before/));
  });

  it('rejects wire lines that lack a direction prefix or carry broken JSON', async () => {
    const wire = (content: string, recordFormat?: 'jsonl' | 'acp-wire-transcript'): EvidenceBundle => ({
      format: 'governance-evidence-bundle/v1',
      artifacts: [{ ...realBundle.artifacts[1], recordFormat, content }],
    });
    const ref = refFor('arrival-order-observation');
    const resolve = (bundle: EvidenceBundle, field = 'result.id') => new BundleArtifactResolver(bundle).resolve({ ...ref, location: { kind: 'record', record: 1, field } });
    // Bare JSON is not a wire-transcript line: no silent prefix-less fallback.
    await expect(resolve(wire('{"result":{"id":1}}\n', 'acp-wire-transcript'))).resolves.toMatchObject({ status: 'artifact-location-mismatch', reason: expect.stringMatching(/not an acp-wire-transcript line/) });
    await expect(resolve(wire('agent->client {oops\n', 'acp-wire-transcript'))).resolves.toMatchObject({ status: 'artifact-location-mismatch', reason: expect.stringMatching(/not valid JSON after its direction prefix/) });
    await expect(resolve(wire('agent->client {"result":{"id":1}}\n', 'acp-wire-transcript'))).resolves.toMatchObject({ status: 'resolved' });
    // The default format is bare JSONL, so a prefixed line is not silently accepted there.
    await expect(resolve(wire('agent->client {"result":{"id":1}}\n'))).resolves.toMatchObject({ status: 'artifact-location-mismatch', reason: expect.stringMatching(/not valid JSON/) });
    // Blank lines never become records, so record numbers match the producer's.
    await expect(resolve(wire('\nagent->client {"result":{"id":1}}\n\n', 'acp-wire-transcript'))).resolves.toMatchObject({ status: 'resolved' });
  });

  it('opens evidence without moving playback or exposing later frames', async () => {
    const controller = new AcpReplayController(recording);
    controller.seekBreakpoint('failure-result');
    controller.select({ kind: 'evaluation', evaluationId: 'followerMaze.orderedRouting:arrival-4231:arrival-order' });
    const before = structuredClone(controller.getState());
    const available = (before as ReplaySnapshot).availableEvidence;
    expect(available.map(({ evidenceId }) => evidenceId)).toEqual(['arrival-order-rule', 'arrival-order-observation']);
    for (const evidence of available) {
      if (evidence.availability.status === 'captured') expect(await resolver.resolve(evidence.availability.artifact)).toMatchObject({ status: 'resolved' });
    }
    expect(controller.getState()).toEqual(before);
  });
});

describe('parseFieldPath', () => {
  it('splits dotted names and array indexes', () => {
    expect(parseFieldPath('result._meta.diagnostic.related[1]')).toEqual(['result', '_meta', 'diagnostic', 'related', 1]);
    expect(parseFieldPath('[0].a[2][3].b')).toEqual([0, 'a', 2, 3, 'b']);
  });
  it.each(['', 'a.', '.a', 'a..b', 'a[', 'a[]', 'a[-1]', 'a[1.5]', 'a[x]', 'a]b', 'a.[0]', 'a[0]b'])('rejects %j', (path) => {
    expect(typeof parseFieldPath(path)).toBe('string');
  });
});
