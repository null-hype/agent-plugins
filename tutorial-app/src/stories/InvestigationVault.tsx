import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';

// CIT-372: the surface of an investigation. You pre-registered one question in
// the `investigations` vault. An agent, out of sight, tagged a snapshot for each
// question it asked; each tag is the question's text. The vault now holds more
// questions than you declared, so the editor shows a conflict, and Peek opens
// the snapshots behind it.

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export type AgentQuestion = {
  /** The snapshot's tag: the question the agent asked. */
  tag: string;
  snapshot: string;
  /** One line on what the snapshot's evidence showed. */
  evidence: string;
};

export type Investigation = {
  vault: string;
  /** The question you pre-registered. */
  question: string;
  /** The questions the agent tagged snapshots with. */
  agent: AgentQuestion[];
};

const SOURCE = 'investigations';

const vaultText = ({ vault, question }: Investigation) =>
  `/// pass://${vault}: the question you pre-registered.\nvault "${vault}" {\n  item "${question}"\n}\n`;

const snapshotText = (q: AgentQuestion) =>
  `tag: ${q.tag}\nsnapshot: ${q.snapshot}\nevidence: ${q.evidence}\n`;

const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);

export default function InvestigationVault({ investigation, height = 420 }: { investigation: Investigation; height?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const disposables: monaco.IDisposable[] = [];
    const vaultModel = monaco.editor.createModel(vaultText(investigation), 'plaintext', monaco.Uri.parse(`vault://${investigation.vault}/items`));
    // One model per snapshot, named by its tag so Peek's list shows each question,
    // with the snapshot id beside it.
    const snapshots = investigation.agent.map((q) =>
      monaco.editor.createModel(snapshotText(q), 'plaintext', monaco.Uri.from({ scheme: 'restic', authority: q.snapshot, path: '/' + q.tag })));
    const editor = monaco.editor.create(host.current!, {
      model: vaultModel,
      readOnly: true,
      // Read-only editors hide squiggles by default; the conflict is the point here.
      renderValidationDecorations: 'on',
      minimap: { enabled: false },
      lineNumbers: 'off',
      scrollBeyondLastLine: false,
      automaticLayout: true,
    });

    // The conflict is derived, never stored: you declared one question; the vault
    // holds yours plus every question the agent tagged.
    const declared = 1;
    const held = declared + investigation.agent.length;
    const line = 3;
    if (held !== declared) {
      monaco.editor.setModelMarkers(vaultModel, SOURCE, [{
        severity: monaco.MarkerSeverity.Warning,
        source: SOURCE,
        message: `Expected ${count(declared)} question, got ${count(held)}.`,
        startLineNumber: line,
        startColumn: 3,
        endLineNumber: line,
        endColumn: vaultModel.getLineMaxColumn(line),
      }]);
    }

    disposables.push(monaco.languages.registerCodeLensProvider({ pattern: '**/items' }, {
      provideCodeLenses: (model) => model !== vaultModel || held === declared ? { lenses: [], dispose() {} } : {
        lenses: [{
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          command: {
            id: 'editor.action.peekLocations',
            title: `${count(investigation.agent.length)} more questions, from the agent's snapshots · Peek`,
            arguments: [vaultModel.uri, { lineNumber: line, column: 3 }, snapshots.map((m) => ({ uri: m.uri, range: new monaco.Range(1, 1, 1, m.getLineMaxColumn(1)) })), 'peek'],
          },
        }],
        dispose() {},
      },
    }));

    return () => {
      disposables.forEach((d) => d.dispose());
      editor.dispose();
      vaultModel.dispose();
      snapshots.forEach((m) => m.dispose());
    };
  }, [investigation]);

  return <div ref={host} data-testid="investigation-vault" style={{ height, border: '1px solid #ccc' }} />;
}
