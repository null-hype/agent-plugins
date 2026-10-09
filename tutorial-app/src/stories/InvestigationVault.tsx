import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';

// CIT-372 / CIT-373: the surface of an investigation. You pre-registered one
// question in the `investigations` vault. An agent, out of sight, tagged a
// snapshot for each question it asked; each tag is the question's text, and it
// only took a snapshot when it had something to show, so a snapshot *is* its
// diff from the baseline. The vault now holds more questions than you declared,
// so the editor shows a conflict; Peek opens the snapshots behind it, and Go to
// Definition walks from a snapshot's diff into the planted evidence.

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

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
};

export type AgentQuestion = {
  /** The snapshot's tag: the question the agent asked. */
  tag: string;
  snapshot: string;
  /** One line on what the snapshot's evidence showed. */
  evidence: string;
  changes: SnapshotChange[];
};

export type Investigation = {
  vault: string;
  /** The question you pre-registered. */
  question: string;
  /** The questions the agent tagged snapshots with. */
  agent: AgentQuestion[];
};

const SOURCE = 'investigations';
const HEADER = 4; // lines above a snapshot's listing

const vaultText = ({ vault, question }: Investigation) =>
  `/// pass://${vault}: the question you pre-registered.\nvault "${vault}" {\n  item "${question}"\n}\n`;

// A snapshot reads like tar.vim's listing of an archive: what changed since the baseline.
const snapshotText = (q: AgentQuestion) =>
  [`snapshot ${q.snapshot}: ${q.tag}`, `evidence: ${q.evidence}`, '', 'changes since the baseline:',
    ...q.changes.map((c) => `${c.kind}  ${c.path}`)].join('\n') + '\n';

const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);
const snapshotUri = (q: AgentQuestion) => monaco.Uri.from({ scheme: 'restic', authority: q.snapshot, path: '/' + q.tag });
const fileUri = (snapshot: string, path: string) => monaco.Uri.from({ scheme: 'restic', authority: snapshot, path: '/files/' + path });
const warn = (line: number, message: string, model: monaco.editor.ITextModel, column = 1): monaco.editor.IMarkerData => ({
  severity: monaco.MarkerSeverity.Warning, source: SOURCE, message,
  startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: model.getLineMaxColumn(line),
});

/** Lines of `after` that the baseline doesn't have, by line number. */
const addedLines = (after: string, before = '') => {
  const old = new Set(before.split('\n'));
  return after.split('\n').flatMap((text, i) => (text.trim() && !old.has(text) ? [i + 1] : []));
};

// Standalone Monaco opens other models only through a registered opener; Go to
// Definition from a listing (or from inside Peek) lands in the active vault editor.
let active: ((uri: monaco.Uri, selection?: monaco.IRange | monaco.IPosition) => boolean) | undefined;
let openerRegistered = false;

const STYLE = `
.investigation-added { background: rgba(46, 160, 67, 0.15); }
.investigation-added-gutter { border-left: 3px solid #2ea043; margin-left: 3px; }
.investigation-path { font: 12px system-ui, sans-serif; padding: 4px 8px; background: #f3f3f3; border-bottom: 1px solid #ddd; display: flex; gap: 8px; align-items: center; }
.investigation-path button { font: inherit; padding: 0 6px; }
`;

export default function InvestigationVault({ investigation, height = 420 }: { investigation: Investigation; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const back = useRef<() => void>(() => {});
  const [path, setPath] = useState<string[]>([investigation.vault]);

  useEffect(() => {
    const disposables: monaco.IDisposable[] = [];
    const models: monaco.editor.ITextModel[] = [];
    const model = (text: string, uri: monaco.Uri) => {
      const m = monaco.editor.createModel(text, 'plaintext', uri);
      models.push(m);
      return m;
    };
    const vaultModel = model(vaultText(investigation), monaco.Uri.parse(`vault://${investigation.vault}/items`));
    // Where each model sits in the investigation, for the path bar.
    const trail = new Map<string, string[]>([[vaultModel.uri.toString(), [investigation.vault]]]);
    const added = new Map<string, number[]>();
    const baselines = new Map<string, monaco.editor.ITextModel>();

    const snapshots = investigation.agent.map((q) => {
      const listing = model(snapshotText(q), snapshotUri(q));
      trail.set(listing.uri.toString(), [investigation.vault, q.tag]);
      monaco.editor.setModelMarkers(listing, SOURCE, q.changes.flatMap((c, i) =>
        c.note ? [warn(HEADER + 1 + i, c.note, listing, 4)] : []));
      for (const c of q.changes) {
        const file = c.contents === undefined ? undefined : model(c.contents, fileUri(q.snapshot, c.path));
        const base = c.baseline === undefined ? undefined : model(c.baseline, fileUri('baseline', c.path));
        if (base) trail.set(base.uri.toString(), [investigation.vault, q.tag, 'baseline', c.path]);
        if (!file) continue;
        trail.set(file.uri.toString(), [investigation.vault, q.tag, q.snapshot, c.path]);
        added.set(file.uri.toString(), addedLines(c.contents!, c.baseline));
        if (base) baselines.set(file.uri.toString(), base);
        if (c.finding) monaco.editor.setModelMarkers(file, SOURCE, [warn(c.finding.line, c.finding.message, file)]);
      }
      return { q, listing };
    });

    const editor = monaco.editor.create(host.current!, {
      model: vaultModel,
      readOnly: true,
      // Read-only editors hide squiggles by default; the findings are the point here.
      renderValidationDecorations: 'on',
      minimap: { enabled: false },
      lineNumbers: 'off',
      scrollBeyondLastLine: false,
      automaticLayout: true,
    });

    // Mark what a snapshot added, like a diff gutter, wherever a file is shown.
    const marked = new WeakMap<monaco.editor.ICodeEditor, monaco.editor.IEditorDecorationsCollection>();
    const markAdded = (e: monaco.editor.ICodeEditor) => {
      const lines = added.get(e.getModel()?.uri.toString() ?? '') ?? [];
      const decorations = lines.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'investigation-added', linesDecorationsClassName: 'investigation-added-gutter' },
      }));
      const existing = marked.get(e);
      if (existing) existing.set(decorations);
      else marked.set(e, e.createDecorationsCollection(decorations));
    };
    disposables.push(monaco.editor.onDidCreateEditor((e) => {
      e.onDidChangeModel(() => markAdded(e));
      markAdded(e);
    }));

    const show = (uri: monaco.Uri, selection?: monaco.IRange | monaco.IPosition) => {
      const target = monaco.editor.getModel(uri);
      if (!target || !models.includes(target)) return false;
      editor.setModel(target);
      markAdded(editor);
      if (selection) {
        const at = 'startLineNumber' in selection ? selection.startLineNumber : selection.lineNumber;
        editor.setSelection(new monaco.Range(at, 1, at, 1));
        editor.revealLineInCenterIfOutsideViewport(at);
      }
      setPath(trail.get(uri.toString()) ?? [uri.path]);
      editor.focus();
      return true;
    };
    active = show;
    back.current = () => show(vaultModel.uri);
    if (!openerRegistered) {
      openerRegistered = true;
      monaco.editor.registerEditorOpener({ openCodeEditor: (_source, resource, selection) => active?.(resource, selection) ?? false });
    }

    // The conflict is derived, never stored: you declared one question; the vault
    // holds yours plus every question the agent tagged.
    const declared = 1;
    const held = declared + investigation.agent.length;
    const line = 3;
    if (held !== declared) monaco.editor.setModelMarkers(vaultModel, SOURCE, [warn(line, `Expected ${count(declared)} question, got ${count(held)}.`, vaultModel, 3)]);

    const lens = (lineNumber: number, title: string, id = '', args: unknown[] = []) =>
      ({ range: new monaco.Range(lineNumber, 1, lineNumber, 1), command: { id, title, arguments: args } });
    disposables.push(monaco.languages.registerCodeLensProvider({ language: 'plaintext' }, {
      provideCodeLenses: (m) => {
        // The vault: Peek on the snapshots the agent tagged. Each opens on its listing.
        if (m === vaultModel && held !== declared) {
          return { lenses: [lens(line, `${count(investigation.agent.length)} more questions, from the agent's snapshots · Peek`, 'editor.action.peekLocations',
            [vaultModel.uri, { lineNumber: line, column: 3 }, snapshots.map(({ listing }) => ({ uri: listing.uri, range: new monaco.Range(HEADER + 1, 4, HEADER + 1, 4) })), 'peek'])], dispose() {} };
        }
        // A file the snapshot changed: Peek on the baseline it changed from.
        const base = baselines.get(m.uri.toString());
        if (base) return { lenses: [lens(1, 'changed since the baseline · Peek', 'editor.action.peekLocations', [m.uri, { lineNumber: 1, column: 1 }, [{ uri: base.uri, range: new monaco.Range(1, 1, 1, 1) }], 'peek'])], dispose() {} };
        if (added.has(m.uri.toString())) return { lenses: [lens(1, 'not in the baseline: every line is new')], dispose() {} };
        return { lenses: [], dispose() {} };
      },
    }));

    // Go to Definition on a listing line opens that file in the snapshot, at what the check missed.
    disposables.push(monaco.languages.registerDefinitionProvider({ language: 'plaintext' }, {
      provideDefinition: (m, position) => {
        const owner = snapshots.find(({ listing }) => listing === m);
        const change = owner?.q.changes[position.lineNumber - HEADER - 1];
        if (!owner || !change) return null;
        const uri = change.kind === 'D' ? fileUri('baseline', change.path) : fileUri(owner.q.snapshot, change.path);
        const at = change.finding?.line ?? 1;
        return { uri, range: new monaco.Range(at, 1, at, 1) };
      },
    }));

    return () => {
      disposables.forEach((d) => d.dispose());
      if (active === show) active = undefined;
      editor.dispose();
      models.forEach((m) => m.dispose());
    };
  }, [investigation]);

  return (
    <div style={{ border: '1px solid #ccc' }}>
      <style>{STYLE}</style>
      <div className="investigation-path" data-testid="investigation-path">
        {path.length > 1 && <button type="button" onClick={() => back.current()}>↑ vault</button>}
        <span>{path.join('  ›  ')}</span>
      </div>
      <div ref={host} data-testid="investigation-vault" style={{ height }} />
    </div>
  );
}
