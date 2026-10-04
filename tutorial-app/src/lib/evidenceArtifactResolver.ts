import type {
  ArtifactRef,
  ArtifactResolution,
  SuppliedArtifactResolver,
} from './acpReplayContract';

/**
 * How a `record` location is read out of an artifact's bytes. It is declared by
 * the bundle, never inferred from the path or sniffed from the content.
 *
 * - `jsonl`: one bare JSON value per non-blank line (the default).
 * - `acp-wire-transcript`: one non-blank line per wire frame, written as
 *   `<direction> <json>` with direction `client->agent` or `agent->client`
 *   (see `evidence/ghost-trace-v1/README.md`). The direction prefix is part of
 *   the captured bytes and is kept for display; only the JSON payload is
 *   addressable by `field`.
 */
export type RecordFormat = 'jsonl' | 'acp-wire-transcript';

export type BundledArtifact = {
  artifactId: string;
  recordingId: string;
  runId: string;
  frameId: string;
  path: string;
  identity: ArtifactRef['identity'];
  recordFormat?: RecordFormat;
  /** The captured bytes, encoded as UTF-8 text for a portable browser bundle. Never normalised. */
  content: string;
};

export type EvidenceBundle = {
  format: 'governance-evidence-bundle/v1';
  artifacts: readonly BundledArtifact[];
};

const encoder = new TextEncoder();
const WIRE_DIRECTIONS = ['client->agent', 'agent->client'] as const;

export function describeArtifactIdentity(identity: ArtifactRef['identity']): string {
  if (identity.kind === 'revision') return `revision:${identity.revision}`;
  if (identity.kind === 'snapshot') return `snapshot:${identity.snapshotId}`;
  return `capture:${identity.captureId}`;
}

const sameIdentity = (left: ArtifactRef['identity'], right: ArtifactRef['identity']) =>
  describeArtifactIdentity(left) === describeArtifactIdentity(right);

export type FieldSegment = string | number;

/**
 * Parses the structured-field locator grammar: `name`, `.name` and `[index]`
 * steps, e.g. `result._meta.diagnostic.related[1].role`. A leading `[index]` is
 * allowed for records that are themselves arrays. Anything else (empty names,
 * unclosed brackets, non-numeric or signed indexes, trailing dots) is rejected
 * rather than guessed at. Returns the failure reason as a string.
 */
export function parseFieldPath(path: string): FieldSegment[] | string {
  if (path === '') return 'field path is empty';
  const segments: FieldSegment[] = [];
  let rest = path;
  let first = true;
  while (rest.length > 0) {
    const index = /^\[(\d+)\]/.exec(rest);
    if (index) {
      segments.push(Number(index[1]));
      rest = rest.slice(index[0].length);
    } else {
      if (!first) {
        if (!rest.startsWith('.')) return `field path ${JSON.stringify(path)} is malformed near ${JSON.stringify(rest)}`;
        rest = rest.slice(1);
      }
      const name = /^[^.[\]]+/.exec(rest);
      if (!name) return `field path ${JSON.stringify(path)} is malformed near ${JSON.stringify(rest)}`;
      segments.push(name[0]);
      rest = rest.slice(name[0].length);
    }
    first = false;
  }
  return segments;
}

function readField(root: unknown, segments: readonly FieldSegment[]): { found: true; value: unknown } | { found: false } {
  let value = root;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(value) || segment >= value.length) return { found: false };
      value = value[segment];
    } else {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, segment)) return { found: false };
      value = (value as Record<string, unknown>)[segment];
    }
  }
  return { found: true, value };
}

/** Non-blank lines, in order. Record N is the Nth of these (1-based). */
export function recordLines(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => line.trim() !== '');
}

/** The 1-based physical line of the Nth record, for display highlighting. */
export function recordLineNumber(content: string, record: number): number | null {
  let seen = 0;
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    seen += 1;
    if (seen === record) return index + 1;
  }
  return null;
}

function parseRecord(line: string, format: RecordFormat, record: number): { ok: true; value: unknown } | { ok: false; reason: string } {
  let json = line;
  if (format === 'acp-wire-transcript') {
    const direction = WIRE_DIRECTIONS.find((candidate) => line.startsWith(`${candidate} `));
    if (!direction) return { ok: false, reason: `record ${record} is not an acp-wire-transcript line (expected "client->agent <json>" or "agent->client <json>")` };
    json = line.slice(direction.length + 1);
  }
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false, reason: `record ${record} is not valid JSON${format === 'acp-wire-transcript' ? ' after its direction prefix' : ''}` };
  }
}

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

function locationFailure(ref: ArtifactRef, artifact: BundledArtifact): string | null {
  const { content } = artifact;
  const location = ref.location as ArtifactRef['location'] | undefined;
  if (!location || typeof location !== 'object') return 'artifact reference has no location';

  if (location.kind === 'source-range') {
    const { startLine, endLine, startColumn, endColumn } = location;
    if (!isPositiveInteger(startLine) || !isPositiveInteger(endLine)) return 'source range lines must be positive integers';
    if (endLine < startLine) return 'source range ends before it starts';
    const lines = content.split(/\r?\n/);
    if (endLine > lines.length) return 'source range is outside the captured artifact';
    if (startColumn !== undefined && (!isPositiveInteger(startColumn) || startColumn > lines[startLine - 1].length + 1)) return 'start column is outside the captured line';
    if (endColumn !== undefined && (!isPositiveInteger(endColumn) || endColumn > lines[endLine - 1].length + 1)) return 'end column is outside the captured line';
    if (startLine === endLine && startColumn !== undefined && endColumn !== undefined && endColumn < startColumn) return 'source range ends before it starts';
    return null;
  }

  if (location.kind !== 'record') return 'artifact reference has an unsupported location kind';
  if (!isPositiveInteger(location.record)) return 'record must be a positive integer';
  const records = recordLines(content);
  if (location.record > records.length) return 'record is outside the captured artifact';
  if (location.field === undefined) return null;

  const segments = parseFieldPath(location.field);
  if (typeof segments === 'string') return segments;
  const parsed = parseRecord(records[location.record - 1], artifact.recordFormat ?? 'jsonl', location.record);
  if (!parsed.ok) return parsed.reason;
  return readField(parsed.value, segments).found ? null : `field ${location.field} is absent from the captured record`;
}

/**
 * Host-neutral resolver for the compact evidence bundle. Its only input is
 * supplied bytes: it cannot read the workspace and deliberately never falls
 * back from one revision, run, frame, or capture identity to another. It
 * returns the artifact's complete, unmodified bytes; locations are validated
 * against them but never used to slice, rewrite or re-encode the capture.
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
    const reason = locationFailure(ref, artifact);
    if (reason) return { status: 'artifact-location-mismatch', artifact: ref, reason };
    return { status: 'resolved', artifact: ref, bytes: encoder.encode(artifact.content) };
  }
}
