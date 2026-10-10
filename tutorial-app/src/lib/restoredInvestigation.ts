// CIT-392: build the investigation the viewer shows from bytes retrieved from
// Drive, instead of authored strings. The inputs are what a run actually
// leaves: `restic diff --json` between the baseline and the agent's snapshot,
// the files `restic dump` restored from each, and one checker's result. The
// finding count, messages and lines come from that result alone; nothing here
// knows what the planted evidence is.
//
// A required input that was not retrieved fails explicitly (`MissingRetrievedInput`)
// rather than falling back to a local capture or sample data.
import type { AgentQuestion, Investigation, SnapshotChange } from './investigationModel';

/** One `message_type: "change"` line of `restic diff --json`. */
export type ResticChange = { path: string; modifier: '+' | '-' | 'M' };

export type CheckerFinding = { path: string; line: number; message: string };

/** One run of one checker over the restored bytes. */
export type CheckerResult = {
  checker: { name: string; version: string };
  /**
   * `executed`: produced by running the versioned checker on the restored
   * files. `illustrative`: sample output, which exercises the viewer but cannot
   * stand in for a real finding.
   */
  origin: 'executed' | 'illustrative';
  findings: CheckerFinding[];
  /** The checker's raw output, kept as evidence. */
  raw: string;
};

/** Files restored from a snapshot, by path without a leading slash (e.g. `inputs/run_arms.sh`). */
export type RestoredFiles = Record<string, string>;

export class MissingRetrievedInput extends Error {
  constructor(readonly path: string, readonly from: 'agent' | 'baseline' | 'diff') {
    super(`required input ${path} was not retrieved from the ${from} snapshot`);
  }
}

/** The change lines of a `restic diff --json` stream; directories and the statistics line are dropped. */
export function parseResticDiff(ndjson: string): ResticChange[] {
  return ndjson.split('\n').filter(Boolean).flatMap((line) => {
    const o = JSON.parse(line);
    return o.message_type === 'change' && !o.path.endsWith('/') ? [{ path: o.path as string, modifier: o.modifier as ResticChange['modifier'] }] : [];
  });
}

const relative = (path: string) => path.replace(/^\/+/, '');

export function investigationFromRestored(input: {
  vault: string;
  question: string;
  /** The agent's snapshot ID, and its tag (the question the agent asked). */
  snapshot: string;
  tag: string;
  changes: ResticChange[];
  agent: RestoredFiles;
  baseline: RestoredFiles;
  result: CheckerResult;
}): Investigation {
  const { changes, agent, baseline, result } = input;
  const changed = new Set(changes.map((c) => relative(c.path)));
  for (const f of result.findings) {
    if (!changed.has(relative(f.path))) throw new MissingRetrievedInput(f.path, 'diff');
  }

  const built: SnapshotChange[] = changes.map((c) => {
    const path = relative(c.path);
    const kind = c.modifier === '+' ? 'A' : c.modifier === '-' ? 'D' : 'M';
    const contents = agent[path];
    const before = baseline[path];
    if (kind !== 'D' && contents === undefined) throw new MissingRetrievedInput(path, 'agent');
    if (kind !== 'A' && before === undefined) throw new MissingRetrievedInput(path, 'baseline');
    const found = result.findings.find((f) => relative(f.path) === path);
    return {
      kind,
      path,
      ...(contents !== undefined && { contents }),
      ...(before !== undefined && { baseline: before }),
      // A change has a `note`, and so counts as a finding, only if the checker reported it.
      ...(found && { note: found.message, finding: { line: found.line, message: found.message } }),
    };
  });

  const n = result.findings.length;
  const by = `${result.checker.name} ${result.checker.version}`;
  const question: AgentQuestion = {
    tag: input.tag,
    snapshot: input.snapshot,
    evidence: `${result.origin === 'illustrative' ? 'Illustrative: ' : ''}${n} finding${n === 1 ? '' : 's'} from ${by}.`,
    changes: built,
  };
  return { vault: input.vault, question: input.question, agent: [question] };
}
