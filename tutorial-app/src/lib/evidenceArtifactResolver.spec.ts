import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from './acpReplayContract';
import { BundleArtifactResolver, type EvidenceBundle } from './evidenceArtifactResolver';

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
