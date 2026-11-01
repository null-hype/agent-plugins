import type * as Monaco from 'monaco-editor';
import { createReadOnlyEvidenceEditor } from './readOnlyEvidenceEditor';

// Pinned AMD build keeps the published report one static HTML object. Storybook
// uses this same loader, rather than hiding CDN problems behind a bundled copy.
const VS = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs';
let nextInstance = 0;
let loading: Promise<typeof Monaco> | undefined;
function loadMonaco(): Promise<typeof Monaco> {
  return loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = VS + '/loader.js';
    script.referrerPolicy = 'no-referrer';
    const timeout = window.setTimeout(() => reject(new Error('Monaco timed out')), 15000);
    const fail = () => { clearTimeout(timeout); reject(new Error('Monaco unavailable')); };
    script.onerror = fail;
    script.onload = () => {
      const amd = (window as any).require;
      amd.config({ paths: { vs: VS } });
      amd(['vs/editor/editor.main'], () => { clearTimeout(timeout); resolve((window as any).monaco); }, fail);
    };
    document.head.append(script);
  });
}

// The server-rendered annotations are the projection read by Monaco. Mobile,
// disabled JavaScript and a failed CDN retain exactly those same messages.
export function enhancePreregistration(root: HTMLElement) {
  const media = window.matchMedia('(min-width: 900px)');
  const host = root.querySelector<HTMLElement>('[data-claim-editor]')!;
  const status = root.querySelector<HTMLElement>('[data-editor-status]')!;
  const source = root.querySelector<HTMLElement>('[data-preregistration-source]')!.textContent!;
  let disposed = false;
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let model: Monaco.editor.ITextModel | undefined;
  let pending = false;
  const update = async () => {
    if (disposed || !media.matches || editor || pending) return;
    pending = true;
    status.textContent = 'Loading read-only editor…';
    try {
      const monaco = await loadMonaco();
      if (disposed || !media.matches) return;
      if (!monaco.languages.getLanguages().some(language => language.id === 'claim-pkl')) {
        monaco.languages.register({ id: 'claim-pkl' });
        monaco.languages.setMonarchTokensProvider('claim-pkl', { tokenizer: { root: [
          [/\/\/.*$/, 'comment'], [/"(?:[^"\\]|\\.)*"/, 'string'], [/\b(amends|extends|new|import|local|hidden|fixed|const|true|false|null)\b/, 'keyword'], [/\b\d+(?:\.\d+)?\b/, 'number'],
        ] } });
      }
      const file = root.closest<HTMLElement>('[data-preregistration-file]')?.dataset.preregistrationFile || 'Preregistration.pkl';
      model = monaco.editor.createModel(source, 'claim-pkl', monaco.Uri.from({ scheme: 'claim', path: '/' + file, query: String(++nextInstance) }));
      const severity: Record<string, number> = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, information: monaco.MarkerSeverity.Info, hint: monaco.MarkerSeverity.Hint };
      monaco.editor.setModelMarkers(model, 'witness', Array.from(root.querySelectorAll<HTMLElement>('[data-claim-diagnostic]'), element => ({
        startLineNumber: Number(element.dataset.line), endLineNumber: Number(element.dataset.line),
        startColumn: Number(element.dataset.column), endColumn: model!.getLineMaxColumn(Number(element.dataset.line)),
        severity: severity[element.dataset.severity!] ?? monaco.MarkerSeverity.Info,
        message: element.querySelector<HTMLElement>('[data-diagnostic-message]')!.textContent!, source: 'witness',
      })));
      // Set dimensions before creation: hidden hosts otherwise measure as 0x0.
      root.dataset.editorReady = 'true';
      editor = createReadOnlyEvidenceEditor(monaco, host, model, {
        ariaLabel: 'Pkl preregistration, read only', fontSize: 13, lineNumbers: 'on',
        wordWrap: 'on', padding: { top: 16, bottom: 16 }, links: false,
        contextmenu: false, lightbulb: { enabled: 'off' as Monaco.editor.ShowLightbulbIconMode },
      });
      status.textContent = 'Read-only · Findings from this rerun';
    } catch {
      delete root.dataset.editorReady;
      editor?.dispose(); model?.dispose(); editor = undefined; model = undefined;
      status.textContent = 'Editor unavailable. Source and findings are shown below.';
    } finally { pending = false; }
  };
  media.addEventListener('change', update);
  void update();
  return () => { disposed = true; media.removeEventListener('change', update); editor?.dispose(); model?.dispose(); };
}
