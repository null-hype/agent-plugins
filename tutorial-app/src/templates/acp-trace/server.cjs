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

// Preserves the existing otel-warm-log presentation: #region/#endregion
// folding blocks, one per ACP frame, keyword-highlighted actor/action
// headers. Diagnostics (this lesson's `_meta.diagnostic`) render as a plain
// line inside the agent frame's region -- the same "diagnostics and
// feedback" surface the warm log already gives other lessons.
function renderClientPage() {
  return `${sharedHead('ACP Trace: Client')}
  <body>
    <main><div id="monaco-root"></div></main>
    <script>
      ${monacoLoaderScript()}

      let editor = null;
      let model = null;
      let currentRevision = null;

      function configureLanguage(monaco) {
        const languageId = 'acp-warm-log';
        if (monaco.languages.getLanguages().some((l) => l.id === languageId)) return;
        monaco.languages.register({ id: languageId });
        monaco.languages.setLanguageConfiguration(languageId, { comments: { lineComment: '#' } });
        monaco.languages.setMonarchTokensProvider(languageId, {
          tokenizer: {
            root: [
              [/^#region.*$/, 'keyword'],
              [/^#endregion.*$/, 'keyword'],
              [/^  (method|result|diagnostic|note):/, 'type'],
            ],
          },
        });
        monaco.languages.registerFoldingRangeProvider(languageId, {
          provideFoldingRanges(m) {
            const ranges = [];
            const stack = [];
            for (let line = 1; line <= m.getLineCount(); line += 1) {
              const text = m.getLineContent(line).trim();
              if (text.startsWith('#region')) stack.push(line);
              else if (text.startsWith('#endregion')) {
                const start = stack.pop();
                if (start) ranges.push({ start, end: line, kind: monaco.languages.FoldingRangeKind.Region });
              }
            }
            return ranges;
          },
        });
      }

      async function ensureEditor() {
        if (editor) return;
        const monaco = await loadMonaco();
        if (editor) return;
        configureLanguage(monaco);
        model = monaco.editor.createModel(renderTrace(null), 'acp-warm-log');
        editor = monaco.editor.create(document.getElementById('monaco-root'), {
          automaticLayout: true,
          folding: true,
          fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Consolas, monospace',
          fontSize: 13,
          lineNumbers: 'on',
          minimap: { enabled: false },
          model,
          readOnly: true,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          showFoldingControls: 'always',
          theme: 'vs',
          wordWrap: 'on',
        });
      }

      function renderTrace(state) {
        if (!state || !state.frames || state.frames.length === 0) {
          return ['#region waiting for trace', '  note: no frames received yet', '#endregion'].join('\\n');
        }

        const lines = [];
        for (const frame of state.frames) {
          const label = frame.actor + ': ' + frame.action;
          const status = frame.envelope && frame.envelope.result !== undefined ? 'ok' : 'sent';
          lines.push('#region ' + label + ' -> ' + status);
          if (frame.envelope && frame.envelope.method) lines.push('  method: ' + frame.envelope.method);
          if (frame.envelope && frame.envelope.result !== undefined) {
            lines.push('  result: ' + JSON.stringify(frame.envelope.result));
          }
          const diagnostic = frame.envelope && frame.envelope._meta && frame.envelope._meta.diagnostic;
          if (diagnostic) {
            lines.push('  diagnostic: [' + diagnostic.severity + '] ' + diagnostic.code + ' -- ' + diagnostic.message);
          }
          lines.push('#endregion');
        }
        if (state.nextTurn) {
          lines.push('#region ' + state.nextTurn.actor + ': ' + state.nextTurn.action + ' -- blocked');
          lines.push('  note: press Solve to reveal this turn');
          lines.push('#endregion');
        }
        return lines.join('\\n');
      }

      async function applyState(payload) {
        if (typeof payload.revision === 'number' && payload.revision === currentRevision) return;
        currentRevision = payload.revision;
        await ensureEditor();
        const next = renderTrace(payload);
        if (model.getValue() !== next) model.setValue(next);
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || message.type !== 'lesson-state' || message.source !== 'tk-acp-trace-bridge') return;
        applyState(message.payload).catch(() => {});
      });

      ensureEditor().catch(() => {});
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
