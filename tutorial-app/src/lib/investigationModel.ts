// CIT-385 (step 1 of CIT-384), working outside in: the lens / Peek / Go to
// Definition / marker logic of `src/stories/InvestigationVault.tsx`, lifted out
// of Monaco into a plain module.
//
// This module imports neither `monaco` nor `vscode`. From an `Investigation` it
// computes *what* the editor shows -- the documents (URI + text), the markers,
// the lenses (line, title, and the Peek/open target), the definition targets,
// and the diff "added" lines -- as neutral data. `InvestigationVault.tsx` is a
// thin adapter that turns this into Monaco models/providers; a VS Code adapter
// over the same model is step 2.
//
// Positions are 1-based and ranges end-inclusive (Monaco's convention); the VS
// Code adapter shifts to 0-based. Documents cross-reference each other by a
// stable `id` (see `docId`), so a lens or definition target names a document
// without the adapter having to match URI strings.

/** How one revision of the check judged a piece of planted evidence. */
export type Verdict = {
  /** The revision, e.g. a pull request: `#117`. */
  revision: string;
  /** Whether the check passed the planted evidence (a miss) or failed it (caught). */
  passed: boolean;
  /** That revision's check, and the line of the rule that decided. */
  check: { path: string; contents: string; rule: number; note: string };
};

/** One file in a snapshot's diff from the baseline. */
export type SnapshotChange = {
  kind: 'A' | 'M' | 'D';
  path: string;
  /** Why this change matters, shown on its line in the listing. */
  note?: string;
  /** The file in the snapshot (absent for D). */
  contents?: string;
  /** The file in the baseline (absent for A). */
  baseline?: string;
  /** What the check missed, shown where it applies in the file. */
  finding?: { line: number; message: string };
  /** Each revision of the check on this file, oldest first; shown at the finding. */
  verdicts?: Verdict[];
};

export type AgentQuestion = {
  /** The snapshot's tag: the question the agent asked. */
  tag: string;
  snapshot: string;
  /** One line on what the snapshot's evidence showed. */
  evidence: string;
  changes: SnapshotChange[];
};

/** A Proton Drive folder of archives; each one was snapshotted with restic when it arrived. */
export type DriveFolder = {
  folder: string;
  archives: { name: string; snapshot: string; baseline?: boolean }[];
};

export type Investigation = {
  /** Start in this Drive folder instead of the vault. */
  drive?: DriveFolder;
  vault: string;
  /** The question you pre-registered. */
  question: string;
  /** The questions the agent tagged snapshots with. */
  agent: AgentQuestion[];
};

export type Severity = 'warning' | 'info' | 'error';

/** An editor-agnostic URI: the pieces `monaco.Uri.from` / `vscode.Uri.from` take. */
export interface UriDescriptor {
  scheme: string;
  authority?: string;
  path: string;
}

/** A 1-based, end-inclusive range. */
export interface DocumentRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** A diagnostic squiggle on one line. */
export interface Marker {
  line: number;
  column: number;
  endColumn: number;
  message: string;
  severity: Severity;
}

/** A location within a document, named by the document's `id`. */
export interface DocumentLocation {
  doc: string;
  range: DocumentRange;
}

/**
 * A lens on a line. `peek` opens native Peek over the locations; `open` jumps
 * straight to a document at a line; a lens with neither is a label with no
 * command (e.g. "not in the baseline: every line is new").
 */
export interface Lens {
  line: number;
  title: string;
  peek?: { anchor: { lineNumber: number; column: number }; locations: DocumentLocation[] };
  open?: { doc: string; line: number };
}

/** Go to Definition from `line` in a document leads to `target`. */
export interface Definition {
  line: number;
  target: { doc: string; line: number };
}

export interface InvestigationDocument {
  /** Stable cross-reference key; the adapter maps it to the created model. */
  id: string;
  uri: UriDescriptor;
  text: string;
  /** Breadcrumb trail for the path bar when this document is shown. */
  trail: string[];
  markers: Marker[];
  lenses: Lens[];
  definitions: Definition[];
  /**
   * Lines new since this document's diff baseline, for the "added" gutter.
   * `undefined` means "no diff information" (the oldest check revision): no
   * gutter and no "not in the baseline" lens, as distinct from an empty diff.
   */
  addedLines?: number[];
}

export interface InvestigationModel {
  documents: InvestigationDocument[];
  /** The document shown first: the Drive folder, or the vault. */
  homeId: string;
  /** Where the path bar starts (Drive folder, or the vault). */
  start: string[];
}

const HEADER = 4; // lines above a snapshot's listing

/** A stable id for a document, from its URI descriptor. */
function docId(uri: UriDescriptor): string {
  return uri.scheme + '://' + (uri.authority ?? '') + uri.path;
}

const vaultUri = (vault: string): UriDescriptor => ({ scheme: 'vault', authority: vault, path: '/items' });
const driveUri = (folder: string): UriDescriptor => ({ scheme: 'drive', authority: 'proton', path: '/' + folder });
// Everything in a snapshot is `snapshot://<id>/<path>`; the baseline is the snapshot `baseline`.
// A listing is named by its tag, so Peek's title says which question it answers.
const snapshotUri = (q: AgentQuestion): UriDescriptor => ({ scheme: 'snapshot', authority: q.snapshot, path: '/' + q.tag });
const fileUri = (snapshot: string, path: string): UriDescriptor => ({ scheme: 'snapshot', authority: snapshot, path: '/' + path });
// The revision is in the path, so Peek's title says which check you're looking at.
const checkUri = (revision: string, path: string): UriDescriptor => ({ scheme: 'check', path: '/' + revision + '/' + path });

const vaultText = ({ vault, question }: Investigation) =>
  `/// pass://${vault}: the question you pre-registered.\nvault "${vault}" {\n  item "${question}"\n}\n`;

// A snapshot reads like tar.vim's listing of an archive: what changed since the baseline.
const snapshotText = (q: AgentQuestion) =>
  [`snapshot ${q.snapshot}: ${q.tag}`, `evidence: ${q.evidence}`, '', 'changes since the baseline:',
    ...q.changes.map((c) => `${c.kind}  ${c.path}`)].join('\n') + '\n';

const driveText = ({ folder, archives }: DriveFolder) =>
  [`/// Proton Drive: /${folder}. Each archive is a restic snapshot.`,
    ...archives.map((a) => `${a.name}   snapshot ${a.snapshot}${a.baseline ? ' · the baseline' : ''}`)].join('\n') + '\n';

const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);

/** The max column of a 1-based line, matching a Monaco model (line length + 1). */
const maxColumn = (text: string, line: number) => (text.split('\n')[line - 1]?.length ?? 0) + 1;

const warn = (line: number, message: string, text: string, column = 1, severity: Severity = 'warning'): Marker =>
  ({ severity, message, line, column, endColumn: maxColumn(text, line) });

/** Lines of `after` that the baseline doesn't have, by line number. */
const addedLinesOf = (after: string, before = '') => {
  const old = new Set(before.split('\n'));
  return after.split('\n').flatMap((t, i) => (t.trim() && !old.has(t) ? [i + 1] : []));
};

/** Compute the full editor-agnostic model for an investigation. */
export function buildInvestigationModel(investigation: Investigation): InvestigationModel {
  const { drive } = investigation;
  const start = drive ? ['Proton Drive', drive.folder] : [investigation.vault];

  // Documents, built once and cross-referenced by id.
  const docs = new Map<string, InvestigationDocument>();
  const add = (uri: UriDescriptor, text: string, trail: string[]): InvestigationDocument => {
    const id = docId(uri);
    const doc: InvestigationDocument = { id, uri, text, trail, markers: [], lenses: [], definitions: [] };
    docs.set(id, doc);
    return doc;
  };

  const vaultDoc = add(vaultUri(investigation.vault), vaultText(investigation), [investigation.vault]);
  const driveDoc = drive ? add(driveUri(drive.folder), driveText(drive), start) : undefined;
  const home = driveDoc ?? vaultDoc;

  const archiveOf = (q: AgentQuestion) => drive?.archives.find((a) => a.snapshot === q.snapshot);
  // Where a model sits in the investigation: under its archive when the walk
  // starts in Drive, under its question otherwise.
  const under = (q: AgentQuestion) => (archiveOf(q) ? [...start, archiveOf(q)!.name] : [investigation.vault, q.tag]);

  // What a document is compared with when you Peek at it, and the diff gutter.
  const baselineOf = new Map<string, { doc: string; label: string }>();
  const verdictsAt = new Map<string, { line: number; verdicts: { verdict: Verdict; doc: string }[] }>();

  const snapshots = investigation.agent.map((q) => {
    const listing = add(snapshotUri(q), snapshotText(q), under(q));
    listing.markers = q.changes.flatMap((c, i) => (c.note ? [warn(HEADER + 1 + i, c.note, listing.text, 4)] : []));
    // Go to Definition on a listing line opens that file in the snapshot, at what the check missed.
    listing.definitions = q.changes.map((c, i) => {
      const uri = c.kind === 'D' ? fileUri('baseline', c.path) : fileUri(q.snapshot, c.path);
      return { line: HEADER + 1 + i, target: { doc: docId(uri), line: c.finding?.line ?? 1 } };
    });

    for (const c of q.changes) {
      const file = c.contents === undefined ? undefined : add(fileUri(q.snapshot, c.path), c.contents, archiveOf(q) ? [...under(q), c.path] : [...under(q), q.snapshot, c.path]);
      const base = c.baseline === undefined ? undefined : add(fileUri('baseline', c.path), c.baseline, [...under(q), 'baseline', c.path]);
      if (!file) continue;
      file.addedLines = addedLinesOf(c.contents!, c.baseline);
      if (base) baselineOf.set(file.id, { doc: base.id, label: 'the baseline' });
      if (c.finding) file.markers = [warn(c.finding.line, c.finding.message, file.text)];

      // The same evidence, judged by each revision of the check; each compares with the one before.
      let previous: { doc: InvestigationDocument; label: string } | undefined;
      const verdicts = (c.verdicts ?? []).map((verdict) => {
        const check = add(checkUri(verdict.revision, verdict.check.path), verdict.check.contents, [...under(q), verdict.revision, verdict.check.path]);
        check.markers = [warn(verdict.check.rule, verdict.check.note, check.text, 1, verdict.passed ? 'warning' : 'info')];
        if (previous) {
          baselineOf.set(check.id, { doc: previous.doc.id, label: previous.label });
          check.addedLines = addedLinesOf(verdict.check.contents, previous.doc.text);
        }
        previous = { doc: check, label: verdict.revision };
        return { verdict, doc: check.id };
      });
      if (verdicts.length) verdictsAt.set(file.id, { line: c.finding?.line ?? 1, verdicts });
    }
    return { q, listing };
  });

  // The conflict is derived, never stored: you declared one question; the vault
  // holds yours plus every question the agent tagged.
  const declared = 1;
  const held = declared + investigation.agent.length;
  const vaultLine = 3;

  // An archive in Drive: what its snapshot found since the previous archive.
  const findings = (q: AgentQuestion) => q.changes.filter((c) => c.note).length;
  const archiveLines = (drive?.archives ?? []).map((a, i) => ({
    archive: a, line: i + 2, owner: snapshots.find(({ q }) => q.snapshot === a.snapshot),
  }));

  if (driveDoc) {
    driveDoc.markers = archiveLines.flatMap(({ line, owner }) =>
      owner && findings(owner.q) ? [warn(line, `${findings(owner.q)} findings since the last archive.`, driveDoc.text)] : []);
    // The vault: Peek on the agent's snapshots. An archive in Drive opens on its listing.
    driveDoc.lenses = archiveLines.flatMap(({ line, owner }) =>
      owner ? [{ line, title: `${findings(owner.q)} findings · open the archive`, open: { doc: owner.listing.id, line: HEADER + 1 } }] : []);
    driveDoc.definitions = archiveLines.flatMap(({ line, owner }) =>
      owner ? [{ line, target: { doc: owner.listing.id, line: HEADER + 1 } }] : []);
  }

  if (held !== declared) {
    vaultDoc.markers = [warn(vaultLine, `Expected ${count(declared)} question, got ${count(held)}.`, vaultDoc.text, 3)];
    vaultDoc.lenses = [{
      line: vaultLine,
      title: `${count(investigation.agent.length)} more questions, from the agent's snapshots · Peek`,
      peek: {
        anchor: { lineNumber: vaultLine, column: 3 },
        locations: snapshots.map(({ listing }) => ({ doc: listing.id, range: range(HEADER + 1, 4, HEADER + 1, 4) })),
      },
    }];
  }

  // Per-document lenses that depend on the diff/verdict maps built above.
  for (const doc of docs.values()) {
    if (doc === vaultDoc || doc === driveDoc) continue;
    const lenses: Lens[] = [];
    const base = baselineOf.get(doc.id);
    // A file the snapshot changed, or a later check revision: Peek on what it changed from.
    if (base) {
      lenses.push({ line: 1, title: `changed since ${base.label} · Peek`, peek: { anchor: { lineNumber: 1, column: 1 }, locations: [{ doc: base.doc, range: range(1, 1, 1, 1) }] } });
    } else if (doc.addedLines !== undefined) {
      lenses.push({ line: 1, title: 'not in the baseline: every line is new' });
    }
    // Planted evidence: how each revision of the check judged it. Each opens that check at its rule.
    const judged = verdictsAt.get(doc.id);
    for (const { verdict, doc: checkDoc } of judged?.verdicts ?? []) {
      lenses.push({ line: judged!.line, title: `${verdict.revision} ${verdict.passed ? '✗ passed' : '✓ failed'}`, open: { doc: checkDoc, line: verdict.check.rule } });
    }
    doc.lenses = lenses;
  }

  return { documents: [...docs.values()], homeId: home.id, start };
}

function range(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): DocumentRange {
  return { startLineNumber, startColumn, endLineNumber, endColumn };
}
