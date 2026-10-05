import type { ArtifactRef, ArtifactResolution, SuppliedArtifactResolver } from './acpReplayContract';
import { describeArtifactIdentity, recordLineNumber } from './evidenceArtifactResolver';

// CIT-301: what a host sends back to a preview that asked to open one evidence
// row's captured artifact. The warm-log widget is a plain-JS page with no module
// system, so it cannot run the resolver itself; the host (Storybook's preview,
// TutorialKit's bridge) resolves with the shared resolver and answers with this
// plain data. It carries the artifact's own bytes and where to look in them,
// never a reconstruction, and a failure says which identity check failed.

export type ArtifactOpenFailure = 'artifact-not-found' | 'artifact-identity-mismatch' | 'artifact-location-mismatch';

export type ArtifactOpened =
  | {
      status: 'resolved';
      path: string;
      recordingId: string;
      runId: string;
      /** `revision:<commit>`, `capture:<id>` or `snapshot:<id>`: exactly what was requested and matched. */
      identity: string;
      /** The captured bytes, decoded as UTF-8 and never altered. */
      text: string;
      /** The 1-based physical lines the reference points at, when it points at any. */
      highlight?: { from: number; to: number };
    }
  | { status: 'error'; kind: ArtifactOpenFailure; message: string };

const decoder = new TextDecoder();

/** The sentence for a resolution that did not resolve. Shared with the Storybook inspector. */
export function resolutionFailureMessage(resolution: Exclude<ArtifactResolution, { status: 'resolved' }>): string {
  if (resolution.status === 'artifact-identity-mismatch') {
    return `Identity mismatch: bundle has ${resolution.actualIdentity}; requested ${describeArtifactIdentity(resolution.artifact.identity)}.`;
  }
  if (resolution.status === 'artifact-location-mismatch') return `Location mismatch: ${resolution.reason}.`;
  return 'Unavailable: captured artifact was not found in this bundle.';
}

const isArtifactRef = (value: unknown): value is ArtifactRef => {
  const ref = value as Partial<ArtifactRef> | null;
  return typeof ref === 'object' && ref !== null && typeof ref.artifactId === 'string' && typeof ref.path === 'string' && typeof ref.identity === 'object' && ref.identity !== null;
};

/** The artifact references among an evidence row list, in order. Rows without one are summary text only. */
export function relatedArtifacts(rows: readonly { artifact?: ArtifactRef | null }[]): ArtifactRef[] {
  return rows.flatMap((row) => (row.artifact ? [row.artifact] : []));
}

export async function openArtifact(resolver: SuppliedArtifactResolver, ref: ArtifactRef): Promise<ArtifactOpened> {
  if (!isArtifactRef(ref)) {
    return { status: 'error', kind: 'artifact-not-found', message: 'Unavailable: the evidence row did not carry an artifact reference.' };
  }
  const resolution = await resolver.resolve(ref);
  if (resolution.status !== 'resolved') {
    return { status: 'error', kind: resolution.status, message: resolutionFailureMessage(resolution) };
  }
  const text = decoder.decode(resolution.bytes);
  const { location } = ref;
  const recordLine = location?.kind === 'record' ? recordLineNumber(text, location.record) : null;
  const highlight = location?.kind === 'source-range'
    ? { from: location.startLine, to: location.endLine }
    : recordLine ? { from: recordLine, to: recordLine } : undefined;
  return {
    status: 'resolved',
    path: ref.path,
    recordingId: ref.recordingId,
    runId: ref.runId,
    identity: describeArtifactIdentity(ref.identity),
    text,
    ...(highlight ? { highlight } : {}),
  };
}

/** What a preview posts to its host to open one evidence row's artifact. */
export const OPEN_ARTIFACT_REQUEST = 'acp-trace-open-artifact';
const OPEN_ARTIFACT_REPLY = 'acp-trace-artifact-opened';

export type ArtifactOpenReply = { type: typeof OPEN_ARTIFACT_REPLY; source: 'tk-acp-trace-bridge'; requestId: number; opened: ArtifactOpened };

/**
 * The host's whole job for one request: resolve with the shared resolver and
 * hand back the reply to post to the frame that asked. A lesson with no bundle
 * answers that it has none, so a row is never shown as opened without bytes.
 */
export async function answerOpenRequest(
  resolver: SuppliedArtifactResolver | null,
  request: { requestId: number; artifact: ArtifactRef },
): Promise<ArtifactOpenReply> {
  const opened: ArtifactOpened = resolver
    ? await openArtifact(resolver, request.artifact)
    : { status: 'error', kind: 'artifact-not-found', message: 'Unavailable: this lesson carries no evidence bundle.' };
  return { type: OPEN_ARTIFACT_REPLY, source: 'tk-acp-trace-bridge', requestId: request.requestId, opened };
}
