import type {
  ArtifactRef,
  ArtifactResolution,
  SuppliedArtifactResolver,
} from './acpReplayContract';

export type BundledArtifact = {
  artifactId: string;
  recordingId: string;
  runId: string;
  frameId: string;
  path: string;
  identity: ArtifactRef['identity'];
  /** The captured bytes, encoded as UTF-8 text for a portable browser bundle. */
  content: string;
};

export type EvidenceBundle = {
  format: 'governance-evidence-bundle/v1';
  artifacts: readonly BundledArtifact[];
};

const encoder = new TextEncoder();

export function describeArtifactIdentity(identity: ArtifactRef['identity']): string {
  if (identity.kind === 'revision') return `revision:${identity.revision}`;
  if (identity.kind === 'snapshot') return `snapshot:${identity.snapshotId}`;
  return `capture:${identity.captureId}`;
}

const sameIdentity = (left: ArtifactRef['identity'], right: ArtifactRef['identity']) =>
  describeArtifactIdentity(left) === describeArtifactIdentity(right);

function locationFailure(ref: ArtifactRef, content: string): string | null {
  if (ref.location.kind === 'source-range') {
    const lines = content.split(/\r?\n/);
    const { startLine, endLine, startColumn, endColumn } = ref.location;
    if (startLine < 1 || endLine < startLine || endLine > lines.length) return 'source range is outside the captured artifact';
    if (startColumn !== undefined && (startColumn < 1 || startColumn > lines[startLine - 1].length + 1)) return 'start column is outside the captured line';
    if (endColumn !== undefined && (endColumn < 1 || endColumn > lines[endLine - 1].length + 1)) return 'end column is outside the captured line';
    return null;
  }

  const records = content.split(/\r?\n/).filter(Boolean);
  if (!Number.isInteger(ref.location.record) || ref.location.record < 1 || ref.location.record > records.length) return 'record is outside the captured artifact';
  if (!ref.location.field) return null;
  try {
    let value: unknown = JSON.parse(records[ref.location.record - 1]);
    for (const segment of ref.location.field.split('.')) {
      if (!value || typeof value !== 'object' || !(segment in value)) return `field ${ref.location.field} is absent from the captured record`;
      value = (value as Record<string, unknown>)[segment];
    }
    return null;
  } catch {
    return 'captured record is not JSON';
  }
}

/**
 * Host-neutral resolver for the compact evidence bundle. Its only input is
 * supplied bytes: it cannot read the workspace and deliberately never falls
 * back from one revision, run, frame, or capture identity to another.
 */
export class BundleArtifactResolver implements SuppliedArtifactResolver {
  constructor(private readonly bundle: EvidenceBundle) {}

  async resolve(ref: ArtifactRef): Promise<ArtifactResolution> {
    const candidates = this.bundle.artifacts.filter((artifact) =>
      artifact.artifactId === ref.artifactId
      && artifact.recordingId === ref.recordingId
      && artifact.runId === ref.runId
      && artifact.frameId === ref.frameId
      && artifact.path === ref.path,
    );
    const artifact = candidates.find((candidate) => sameIdentity(candidate.identity, ref.identity));
    if (!artifact) {
      if (candidates.length > 0) {
        return {
          status: 'artifact-identity-mismatch',
          artifact: ref,
          actualIdentity: candidates.map(({ identity }) => describeArtifactIdentity(identity)).join(', '),
        };
      }
      return { status: 'artifact-not-found', artifact: ref };
    }
    const reason = locationFailure(ref, artifact.content);
    if (reason) return { status: 'artifact-location-mismatch', artifact: ref, reason };
    return { status: 'resolved', artifact: ref, bytes: encoder.encode(artifact.content) };
  }
}
