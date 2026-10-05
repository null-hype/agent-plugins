import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from './acpReplayContract';
import { answerOpenRequest, openArtifact, relatedArtifacts } from './artifactOpen';
import { BundleArtifactResolver, type EvidenceBundle } from './evidenceArtifactResolver';
import bundleJson from '../content/tutorial/part-4/can-the-checker-be-trusted/1-can-the-check-tell-a-real-file-read-from-a-forged-one/_files/evidence-bundle.json';
import solved from '../stories/fixtures/rails-matlab-review-1.solved.json';

// CIT-301: the first Rails/MATLAB interaction on the shared inspector. A row of
// review 1's evidence that cites a captured file opens that file's own bytes,
// at the commit review 1 read it. These checks run on the committed lesson
// bundle and the committed solved trace, the two things a host actually has.

const resolver = new BundleArtifactResolver(bundleJson as EvidenceBundle);
const manifest = JSON.parse(readFileSync(new URL('../../evidence/cit-294-review-history-v1/manifest.json', import.meta.url), 'utf8')) as {
  files: { revision: string; path: string; sha256: string }[];
};
const { diagnostic } = solved.frames[1].envelope.result._meta;
const [cited] = relatedArtifacts(diagnostic.related);

describe('opening the captured file behind an evidence row', () => {
  it('finds exactly the row that cites a captured file', () => {
    expect(relatedArtifacts(diagnostic.related)).toHaveLength(1);
    expect(cited.path).toBe('docs/investigations/CIT-265/cit-294/Reconcile.pkl');
    // The other rows are summary text only: nothing is made up for them.
    expect(diagnostic.related.filter((row: { artifact?: unknown }) => !row.artifact)).toHaveLength(diagnostic.related.length - 1);
  });

  it('opens the pinned bytes, byte for byte, with the cited line marked', async () => {
    const opened = await openArtifact(resolver, cited);
    if (opened.status !== 'resolved') throw new Error(`expected resolved, got ${opened.message}`);
    const pinned = manifest.files.find((file) => file.revision === cited.identity.revision && file.path === cited.path)!;
    expect(createHash('sha256').update(opened.text).digest('hex')).toBe(pinned.sha256);
    // The bundle records the manifest's digest, so the bytes can be checked wherever they travel.
    expect(bundleJson.artifacts[0].sha256).toBe(pinned.sha256);
    expect(opened.identity).toBe('revision:20aafd26372a832224be824f72f4a615ee671094');
    expect(opened.recordingId).toBe('cit-294-review-history-v1');
    expect(opened.runId).toBe('cit-294-117-118-120');
    expect(opened.highlight).toEqual({ from: 17, to: 17 });
    expect(opened.text.split('\n')[16]).toMatch(/^function check\(claim/);
  });

  it('is plain data a frame can receive', async () => {
    expect(structuredClone(await openArtifact(resolver, cited))).toEqual(await openArtifact(resolver, cited));
  });

  it('refuses bytes that no longer match the digest recorded when the bundle was built', async () => {
    // The lesson ships the bundle as an editable file; an edit must not pass as the pinned commit.
    const tampered = structuredClone(bundleJson) as EvidenceBundle;
    const [only] = tampered.artifacts as { content: string }[];
    only.content = only.content.replace('function check(', 'function chuck(');
    const opened = await openArtifact(new BundleArtifactResolver(tampered), cited);
    expect(opened).toMatchObject({ status: 'error', kind: 'artifact-identity-mismatch' });
    expect(opened.status === 'error' && opened.message).toContain('sha256:');
    expect(opened.status === 'error' && opened.message).toContain(bundleJson.artifacts[0].sha256);
  });

  it('still opens a bundle that records no digest', async () => {
    const bare = structuredClone(bundleJson) as EvidenceBundle & { artifacts: { sha256?: string }[] };
    delete bare.artifacts[0].sha256;
    expect(await openArtifact(new BundleArtifactResolver(bare), cited)).toMatchObject({ status: 'resolved' });
  });

  it('refuses an abbreviated revision instead of guessing the commit', async () => {
    const abbreviated: ArtifactRef = { ...cited, identity: { kind: 'revision', revision: '20aafd26' } };
    const opened = await openArtifact(resolver, abbreviated);
    expect(opened).toMatchObject({ status: 'error', kind: 'artifact-identity-mismatch' });
    expect(opened.status === 'error' && opened.message).toContain('revision:20aafd26372a832224be824f72f4a615ee671094');
    expect(opened.status === 'error' && opened.message).toContain('revision:20aafd26');
  });

  it('does not fall back to another revision of the same path', async () => {
    const other: ArtifactRef = { ...cited, identity: { kind: 'revision', revision: '8d097c8e16bd1db44d5d4f558ad99938585e1001' } };
    expect(await openArtifact(resolver, other)).toMatchObject({ status: 'error', kind: 'artifact-identity-mismatch' });
  });

  it('says so when the bundle does not hold the artifact', async () => {
    expect(await openArtifact(resolver, { ...cited, artifactId: 'artifact:nope' })).toMatchObject({ status: 'error', kind: 'artifact-not-found' });
    expect(await openArtifact(new BundleArtifactResolver({ format: 'governance-evidence-bundle/v1', artifacts: [] }), cited)).toMatchObject({ status: 'error', kind: 'artifact-not-found' });
  });

  it('says so when the cited lines are outside the captured file', async () => {
    const beyond: ArtifactRef = { ...cited, location: { kind: 'source-range', startLine: 9000, endLine: 9001 } };
    expect(await openArtifact(resolver, beyond)).toMatchObject({ status: 'error', kind: 'artifact-location-mismatch' });
  });

  it('rejects anything that is not an artifact reference', async () => {
    expect(await openArtifact(resolver, { path: 'x' } as unknown as ArtifactRef)).toMatchObject({ status: 'error', kind: 'artifact-not-found' });
    expect(await openArtifact(resolver, null as unknown as ArtifactRef)).toMatchObject({ status: 'error', kind: 'artifact-not-found' });
  });
});

describe('the host answering a preview', () => {
  it('replies to the request that asked, with the opened file', async () => {
    const reply = await answerOpenRequest(resolver, { requestId: 7, artifact: cited });
    expect(reply).toMatchObject({ type: 'acp-trace-artifact-opened', source: 'tk-acp-trace-bridge', requestId: 7 });
    expect(reply.opened).toEqual(await openArtifact(resolver, cited));
  });

  it('says a lesson has no bundle instead of showing a row as opened', async () => {
    const reply = await answerOpenRequest(null, { requestId: 1, artifact: cited });
    expect(reply.opened).toMatchObject({ status: 'error', kind: 'artifact-not-found' });
    expect(reply.opened.status === 'error' && reply.opened.message).toContain('no evidence bundle');
  });
});

