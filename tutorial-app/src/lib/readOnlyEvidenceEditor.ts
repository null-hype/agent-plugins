import type * as Monaco from 'monaco-editor';

// Shared by Investigations and the static claim page. No LSP or check runs here.
export function createReadOnlyEvidenceEditor(monaco: typeof Monaco, host: HTMLElement, model: Monaco.editor.ITextModel, options: Monaco.editor.IStandaloneEditorConstructionOptions = {}) {
  return monaco.editor.create(host, {
    model, readOnly: true, domReadOnly: true,
    renderValidationDecorations: 'on', occurrencesHighlight: 'off',
    minimap: { enabled: false }, scrollBeyondLastLine: false,
    automaticLayout: true, ...options,
  });
}
