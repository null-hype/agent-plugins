import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import {
  buildInvestigationModel,
  type DocumentRange,
  type Investigation,
  type InvestigationDocument,
  type Severity,
} from '../lib/investigationModel';

// CIT-372 / CIT-373 / CIT-374 / CIT-376 / CIT-385: the surface of an investigation. You
// pre-registered one question in the `investigations` vault. An agent, out of
// sight, tagged a snapshot for each question it asked; each tag is the
// question's text, and it only took a snapshot when it had something to show,
// so a snapshot *is* its diff from the baseline. The vault now holds more
// questions than you declared, so the editor shows a conflict; Peek opens the
// snapshots behind it, and Go to Definition walks from a snapshot's diff into
// the planted evidence, and from there to each revision of the check that
// judged it. With a Proton Drive folder, the walk starts where an archive
// arrived: its restic repository lives on Drive, and the diagnostics land on
// the archive.
//
// CIT-385: *what* this shows -- documents, markers, lenses, definition targets,
// added lines -- is computed by `../lib/investigationModel` with no Monaco. This
// component is the Monaco *adapter*: it turns that model into editor models and
// providers. A VS Code adapter over the same module is step 2. The investigation
// domain types live in the module and are re-exported here for existing imports.
export type { Investigation, DriveFolder, AgentQuestion, SnapshotChange, Verdict } from '../lib/investigationModel';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const SOURCE = 'investigations';

const SEVERITY: Record<Severity, monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
};

const toRange = (r: DocumentRange) => new monaco.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn);
const atLine = (line: number) => new monaco.Range(line, 1, line, 1);

// Standalone Monaco opens other models only through a registered opener; Go to
// Definition from a listing (or from inside Peek) lands in the active vault editor.
let active: ((uri: monaco.Uri, selection?: monaco.IRange | monaco.IPosition) => boolean) | undefined;
let openerRegistered = false;
const OPEN = 'investigation.open';

const STYLE = `
.investigation-added { background: rgba(46, 160, 67, 0.15); }
.investigation-added-gutter { border-left: 3px solid #2ea043; margin-left: 3px; }
.investigation-path { font: 12px system-ui, sans-serif; padding: 4px 8px; background: #f3f3f3; border-bottom: 1px solid #ddd; display: flex; gap: 8px; align-items: center; }
.investigation-path button { font: inherit; padding: 0 6px; }
`;

export default function InvestigationVault({ investigation, height = 420 }: { investigation: Investigation; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const back = useRef<() => void>(() => {});
  const start = investigation.drive ? ['Proton Drive', investigation.drive.folder] : [investigation.vault];
  const [path, setPath] = useState<string[]>(start);

  useEffect(() => {
    const model = buildInvestigationModel(investigation);
    const disposables: monaco.IDisposable[] = [];
    const models: monaco.editor.ITextModel[] = [];

    // Create one Monaco model per document. Key every lookup on Monaco's own
    // `uri.toString()` (recorded here), never on the module's ids: Monaco
    // percent-encodes characters like `#`, so the two strings differ.
    const uriById = new Map<string, monaco.Uri>();
    const docByUri = new Map<string, InvestigationDocument>();
    const trail = new Map<string, string[]>();
    const added = new Map<string, number[]>();
    for (const doc of model.documents) {
      const uri = monaco.Uri.from(doc.uri);
      const m = monaco.editor.createModel(doc.text, 'plaintext', uri);
      models.push(m);
      uriById.set(doc.id, uri);
      docByUri.set(uri.toString(), doc);
      trail.set(uri.toString(), doc.trail);
      if (doc.addedLines !== undefined) added.set(uri.toString(), doc.addedLines);
      if (doc.markers.length) {
        monaco.editor.setModelMarkers(m, SOURCE, doc.markers.map((mk) => ({
          severity: SEVERITY[mk.severity], source: SOURCE, message: mk.message,
          startLineNumber: mk.line, startColumn: mk.column, endLineNumber: mk.line, endColumn: mk.endColumn,
        })));
      }
    }
    const home = monaco.editor.getModel(uriById.get(model.homeId)!)!;

    const editor = monaco.editor.create(host.current!, {
      model: home,
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
        range: atLine(line),
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
        editor.setSelection(atLine(at));
        editor.revealLineInCenterIfOutsideViewport(at);
      }
      setPath(trail.get(uri.toString()) ?? [uri.path]);
      editor.focus();
      return true;
    };
    active = show;
    back.current = () => show(home.uri);
    if (!openerRegistered) {
      openerRegistered = true;
      monaco.editor.registerEditorOpener({ openCodeEditor: (_source, resource, selection) => active?.(resource, selection) ?? false });
      monaco.editor.registerCommand(OPEN, (_accessor, uri: monaco.Uri, line: number) => active?.(uri, { lineNumber: line, column: 1 }));
    }

    disposables.push(monaco.languages.registerCodeLensProvider({ language: 'plaintext' }, {
      provideCodeLenses: (m) => {
        const doc = docByUri.get(m.uri.toString());
        if (!doc) return { lenses: [], dispose() {} };
        const lenses = doc.lenses.map((l) => {
          const range = atLine(l.line);
          if (l.peek) {
            const locations = l.peek.locations.map((loc) => ({ uri: uriById.get(loc.doc)!, range: toRange(loc.range) }));
            return { range, command: { id: 'editor.action.peekLocations', title: l.title, arguments: [m.uri, { lineNumber: l.peek.anchor.lineNumber, column: l.peek.anchor.column }, locations, 'peek'] } };
          }
          if (l.open) {
            return { range, command: { id: OPEN, title: l.title, arguments: [uriById.get(l.open.doc)!, l.open.line] } };
          }
          // A label with no command (e.g. "not in the baseline: every line is new").
          return { range, command: { id: '', title: l.title, arguments: [] } };
        });
        return { lenses, dispose() {} };
      },
    }));

    disposables.push(monaco.languages.registerDefinitionProvider({ language: 'plaintext' }, {
      provideDefinition: (m, position) => {
        const doc = docByUri.get(m.uri.toString());
        const def = doc?.definitions.find((d) => d.line === position.lineNumber);
        if (!def) return null;
        return { uri: uriById.get(def.target.doc)!, range: atLine(def.target.line) };
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
        {path.length > start.length && <button type="button" onClick={() => back.current()}>↑ {investigation.drive ? 'Drive' : 'vault'}</button>}
        <span>{path.join('  ›  ')}</span>
      </div>
      <div ref={host} data-testid="investigation-vault" style={{ height }} />
    </div>
  );
}
