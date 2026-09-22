// CIT-245: two independent HTTP servers in one process, one per preview
// ("agent" and "client") -- TutorialKit/WebContainer watches for a server to
// come up on each port named in the lesson's `previews` frontmatter and
// gives each its own preview pane; it does not split one port into two.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, resolve, sep } = require('node:path');

const host = '0.0.0.0';
// TutorialKit injects PORT for whichever port a lesson's `previews` names
// first; AGENT_PORT is never injected by anything, so its 4174 default must
// stay in sync by hand with the second `previews` entry in every lesson's
// content.mdx that uses this template -- nothing enforces that pairing.
const clientPort = Number(process.env.PORT || 4173);
const agentPort = Number(process.env.AGENT_PORT || 4174);
const monacoRoot = resolve(process.cwd(), 'node_modules', 'monaco-editor', 'min');

function sendText(response, body, statusCode = 200, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

function getContentType(filePath) {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.ttf':
      return 'font/ttf';
    default:
      return 'application/octet-stream';
  }
}

function isInside(basePath, targetPath) {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${sep}`);
}

async function serveFile(response, filePath) {
  try {
    const fileContents = await readFile(filePath);

    response.writeHead(200, {
      'cache-control': 'public, max-age=300',
      'content-type': getContentType(filePath),
    });
    response.end(fileContents);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendText(response, 'Not found', 404);
      return;
    }

    sendText(response, 'Unable to load asset', 500);
  }
}

// Shared by both pages: Monaco boot, a #region/#endregion folding language,
// and the `lesson-state` listener that reads an AcpTraceState payload
// (acpTraceProtocol.ts's shape) broadcast from AcpTraceBridge. Each page
// then renders that same payload its own way -- see renderClientPage /
// renderAgentPage below.
function sharedHead(title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; }
      body { overflow: hidden; background: #fffdf8; }
      main { width: 100vw; height: 100vh; }
      #monaco-root { width: 100%; height: 100%; }
    </style>
  </head>`;
}

function monacoLoaderScript() {
  return `
      function loadMonaco() {
        if (window.__monacoPromise) return window.__monacoPromise;
        window.__monacoPromise = new Promise((resolve, reject) => {
          if (window.monaco && window.require) {
            window.require.config({ paths: { vs: '/monaco/vs' } });
            window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
            return;
          }
          const script = document.createElement('script');
          script.src = '/monaco/vs/loader.js';
          script.onload = () => {
            window.require.config({ paths: { vs: '/monaco/vs' } });
            window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
          };
          script.onerror = () => reject(new Error('Failed to load Monaco assets'));
          document.head.appendChild(script);
        });
        return window.__monacoPromise;
      }`;
}

// CIT-247: one Monaco line per frame -- the same {raw, diagnostic, related}
// rendering contract the otel-warm-log template already draws real markers/
// hover/CodeLens/an evidence widget for (see that template's
// registerHoverProvider/registerCodeLensProvider/buildEvidenceDomNode this
// duplicates). `toWarmLogLine` below mirrors acpTraceProtocol.ts's function
// of the same name -- that's the real, unit-tested mapping; this is a
// duplicate because templates are plain HTML/JS strings with no shared
// module system between them, not a second source of truth for the mapping
// logic itself.
function renderClientPage() {
  return `${sharedHead('ACP Trace: Client')}
  <body>
    <main><div id="monaco-root"></div></main>
    <script>
      ${monacoLoaderScript()}

      let editor = null;
      let model = null;
      let currentRevision = null;
      let diagnosticsByLine = {};
      let relatedByLine = {};
      let evidenceWidgetLine = null;
      const MARKER_OWNER = 'acp-trace';
      const PEEK_EVIDENCE_COMMAND = 'acp-trace.peekEvidence';
      const EVIDENCE_WIDGET_ID = 'acp-trace.evidenceWidget';

      function buildEvidenceDomNode(related) {
        const node = document.createElement('div');
        node.setAttribute('role', 'region');
        node.setAttribute('aria-label', 'Diagnostic evidence');
        node.className = 'evidence-widget';
        node.style.cssText =
          'background:#1e1e1e;color:#d4d4d4;border:1px solid #454545;border-radius:3px;' +
          'padding:6px 10px;font:12px "Roboto Mono",Menlo,Consolas,monospace;width:600px;max-width:80vw;max-height:300px;overflow:auto;white-space:pre-wrap;';
        related.forEach((entry) => {
          const row = document.createElement('div');
          const where = entry.uri + (entry.revision ? '@' + entry.revision : '') + (entry.line ? ':' + entry.line : '');
          row.textContent = entry.role + ' (' + where + '): ' + entry.detail;
          row.style.padding = '2px 0';
          node.appendChild(row);
        });
        return node;
      }

      function toggleEvidenceWidget(monacoEditor, lineNumber, related) {
        if (evidenceWidgetLine !== null) {
          monacoEditor.removeContentWidget({ getId: () => EVIDENCE_WIDGET_ID });
          const wasShowingThisLine = evidenceWidgetLine === lineNumber;
          evidenceWidgetLine = null;
          if (wasShowingThisLine) return;
        }
        const domNode = buildEvidenceDomNode(related);
        monacoEditor.addContentWidget({
          getId: () => EVIDENCE_WIDGET_ID,
          getDomNode: () => domNode,
          getPosition: () => ({
            position: { lineNumber, column: 1 },
            preference: [window.monaco.editor.ContentWidgetPositionPreference.BELOW],
          }),
        });
        evidenceWidgetLine = lineNumber;
      }

      function configureLanguage(monaco) {
        const languageId = 'acp-warm-log';
        if (monaco.languages.getLanguages().some((l) => l.id === languageId)) return;
        monaco.languages.register({ id: languageId });
        monaco.languages.setLanguageConfiguration(languageId, { comments: { lineComment: '#' } });
        monaco.languages.setMonarchTokensProvider(languageId, {
          tokenizer: { root: [[/^(client|agent): .*$/, 'keyword']] },
        });

        monaco.languages.registerHoverProvider(languageId, {
          provideHover(hoverModel, position) {
            const diagnostic = diagnosticsByLine[position.lineNumber];
            if (!diagnostic) return null;
            const related = relatedByLine[position.lineNumber] || [];
            const contents = [{ value: '**' + diagnostic.code + '**' }, { value: diagnostic.message }];
            for (const entry of related) contents.push({ value: '_' + entry.role + '_ (' + entry.uri + '): ' + entry.detail });
            return {
              range: new monaco.Range(position.lineNumber, 1, position.lineNumber, hoverModel.getLineMaxColumn(position.lineNumber)),
              contents,
            };
          },
        });

        monaco.editor.registerCommand(PEEK_EVIDENCE_COMMAND, (_accessor, lineNumber) => {
          if (!editor) return;
          const related = relatedByLine[lineNumber] || [];
          if (related.length === 0) return;
          editor.setPosition({ column: 1, lineNumber });
          toggleEvidenceWidget(editor, lineNumber, related);
        });

        monaco.languages.registerCodeLensProvider(languageId, {
          provideCodeLenses(lensModel) {
            const lenses = [];
            for (let lineNumber = 1; lineNumber <= lensModel.getLineCount(); lineNumber += 1) {
              const diagnostic = diagnosticsByLine[lineNumber];
              if (!diagnostic) continue;
              const relatedCount = (relatedByLine[lineNumber] || []).length;
              const prefix = diagnostic.severity === 'warning' ? '⚠ ' : diagnostic.severity === 'info' ? 'ℹ ' : '✗ ';
              lenses.push({
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                command: { id: PEEK_EVIDENCE_COMMAND, title: prefix + diagnostic.code + ' · ' + relatedCount + ' related', arguments: [lineNumber] },
              });
            }
            return { lenses, dispose() {} };
          },
        });
      }

      async function ensureEditor() {
        if (editor) return;
        const monaco = await loadMonaco();
        if (editor) return;
        configureLanguage(monaco);
        model = monaco.editor.createModel('', 'acp-warm-log');
        editor = monaco.editor.create(document.getElementById('monaco-root'), {
          automaticLayout: true,
          fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Consolas, monospace',
          fontSize: 13,
          glyphMargin: true,
          lineDecorationsWidth: 12,
          lineNumbers: 'on',
          minimap: { enabled: false },
          model,
          readOnly: true,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          theme: 'vs',
          wordWrap: 'on',
        });
      }

      // Mirrors acpTraceProtocol.ts's extractPromptText -- \`session/prompt\`'s
      // \`params.prompt\` is a list of content blocks; only \`text\` blocks render.
      function extractPromptText(params) {
        if (!params || typeof params !== 'object' || !Array.isArray(params.prompt)) return null;
        const texts = params.prompt
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text);
        return texts.length > 0 ? texts.join(' ') : null;
      }

      // Mirrors acpTraceProtocol.ts's toWarmLogLine.
      function toWarmLogLine(frame) {
        const envelope = frame.envelope || {};
        const diagnostic = envelope.result && envelope.result._meta && envelope.result._meta.diagnostic;
        const promptText = extractPromptText(envelope.params);
        const status = diagnostic ? diagnostic.code : envelope.result !== undefined ? 'ok' : 'sent';
        const call = envelope.method ? envelope.method + (promptText ? ' "' + promptText + '"' : '') : null;
        return {
          raw: [frame.actor + ': ' + frame.action, '->', status, call].filter(Boolean).join('  '),
          diagnostic: diagnostic ? { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message } : null,
          related: (diagnostic && diagnostic.related) || [],
        };
      }

      function renderRecords(state) {
        if (!state || !state.frames || state.frames.length === 0) {
          return [{ raw: 'waiting for trace: no frames received yet', diagnostic: null, related: [] }];
        }
        const records = state.frames.map(toWarmLogLine);
        if (state.nextTurn) {
          records.push({
            raw: state.nextTurn.actor + ': ' + state.nextTurn.action + '  ->  blocked (press Solve)',
            diagnostic: null,
            related: [],
          });
        }
        return records;
      }

      async function renderIntoEditor(records) {
        await ensureEditor();
        const lines = [];
        const markers = [];
        diagnosticsByLine = {};
        relatedByLine = {};
        if (evidenceWidgetLine !== null) {
          editor.removeContentWidget({ getId: () => EVIDENCE_WIDGET_ID });
          evidenceWidgetLine = null;
        }

        records.forEach((record, index) => {
          const lineNumber = index + 1;
          lines.push(record.raw);
          if (record.diagnostic) {
            diagnosticsByLine[lineNumber] = record.diagnostic;
            markers.push({
              startLineNumber: lineNumber,
              startColumn: 1,
              endLineNumber: lineNumber,
              endColumn: Math.max(2, record.raw.length + 1),
              severity:
                record.diagnostic.severity === 'error'
                  ? window.monaco.MarkerSeverity.Error
                  : record.diagnostic.severity === 'warning'
                    ? window.monaco.MarkerSeverity.Warning
                    : window.monaco.MarkerSeverity.Info,
              message: record.diagnostic.message,
              code: record.diagnostic.code,
            });
            if (record.related.length > 0) relatedByLine[lineNumber] = record.related;
          }
        });

        const nextText = lines.join('\\n');
        if (model.getValue() !== nextText) model.setValue(nextText);
        window.monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
      }

      async function applyState(payload) {
        if (typeof payload.revision === 'number' && payload.revision === currentRevision) return;
        currentRevision = payload.revision;
        await renderIntoEditor(renderRecords(payload));
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.type !== 'lesson-state' || message.source !== 'tk-acp-trace-bridge') return;
        applyState(message.payload).catch(() => {});
      });

      // Announce readiness (mirrors otel-warm-log's own page) only once the
      // listener above is registered -- AcpTraceBridge answers this with the
      // current state, sent straight to whichever frame just asked, rather
      // than guessing how long a WebContainer boot or a reload takes.
      window.parent.postMessage({ type: 'lesson-preview-ready', source: 'tk-acp-trace-client-preview' }, '*');

      renderIntoEditor(renderRecords(null)).catch(() => {});
    </script>
  </body>
</html>`;
}

// The agent-side pane: the raw ACP JSON-RPC envelopes as the agent process
// would actually see/emit them -- protocol fidelity over narrative, which is
// what distinguishes this pane from the client warm log above.
function renderAgentPage() {
  return `${sharedHead('ACP Trace: Agent')}
  <body>
    <main><div id="monaco-root"></div></main>
    <script>
      ${monacoLoaderScript()}

      let editor = null;
      let model = null;
      let currentRevision = null;

      async function ensureEditor() {
        if (editor) return;
        const monaco = await loadMonaco();
        if (editor) return;
        model = monaco.editor.createModel(renderEnvelopes(null), 'json');
        editor = monaco.editor.create(document.getElementById('monaco-root'), {
          automaticLayout: true,
          fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Consolas, monospace',
          fontSize: 13,
          lineNumbers: 'on',
          minimap: { enabled: false },
          model,
          readOnly: true,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          theme: 'vs',
          wordWrap: 'on',
        });
      }

      // One compact JSON line per frame -- not a single pretty-printed array.
      // A lesson's fixture may grow past a handful of frames, and Monaco
      // virtualizes .view-lines to the visible viewport: a tall pretty-printed
      // document would silently drop its tail from any text-content read
      // (this app's own Storybook coverage, and any future reader relying on
      // that DOM, would only ever see the first screenful).
      function renderEnvelopes(state) {
        if (!state || !state.frames || state.frames.length === 0) {
          return JSON.stringify({ note: 'no frames received yet' });
        }
        return state.frames
          .map((frame) => JSON.stringify({ actor: frame.actor, action: frame.action, envelope: frame.envelope }))
          .join('\\n');
      }

      async function applyState(payload) {
        if (typeof payload.revision === 'number' && payload.revision === currentRevision) return;
        currentRevision = payload.revision;
        await ensureEditor();
        const next = renderEnvelopes(payload);
        if (model.getValue() !== next) model.setValue(next);
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.type !== 'lesson-state' || message.source !== 'tk-acp-trace-bridge') return;
        applyState(message.payload).catch(() => {});
      });

      window.parent.postMessage({ type: 'lesson-preview-ready', source: 'tk-acp-trace-agent-preview' }, '*');

      ensureEditor().catch(() => {});
    </script>
  </body>
</html>`;
}

function serveMonacoAssets(request, response, url) {
  if (!url.pathname.startsWith('/monaco/')) return false;

  const relativePath = decodeURIComponent(url.pathname.slice('/monaco/'.length));
  const assetPath = resolve(monacoRoot, relativePath);

  if (!isInside(monacoRoot, assetPath)) {
    sendText(response, 'Invalid asset path', 403);
    return true;
  }

  serveFile(response, assetPath);
  return true;
}

const clientServer = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (serveMonacoAssets(request, response, url)) return;
  sendText(response, renderClientPage(), 200, 'text/html; charset=utf-8');
});

const agentServer = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (serveMonacoAssets(request, response, url)) return;
  sendText(response, renderAgentPage(), 200, 'text/html; charset=utf-8');
});

clientServer.listen(clientPort, host, () => {
  console.log('acp-trace client preview listening on http://%s:%d', host, clientPort);
});

agentServer.listen(agentPort, host, () => {
  console.log('acp-trace agent preview listening on http://%s:%d', host, agentPort);
});
