const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, resolve, sep } = require('node:path');

const host = '0.0.0.0';
const port = Number(process.env.PORT || 4173);
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

function renderPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Goose Trace Template</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
      }

      body {
        overflow: hidden;
        background: #fffdf8;
      }

      main {
        width: 100vw;
        height: 100vh;
      }

      #monaco-root {
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <main>
      <div id="monaco-root"></div>
    </main>

    <script>
      const monacoRootEl = document.getElementById('monaco-root');
      const depthOrder = [0, 1, 99];

      let editor = null;
      let model = null;
      let monacoPromise = null;
      let editorPromise = null;
      let currentDepth = 99;
      let currentRevision = null;
      let runTimers = [];
      let session = null;

      function loadMonaco() {
        if (monacoPromise) {
          return monacoPromise;
        }

        monacoPromise = new Promise((resolve, reject) => {
          if (window.monaco && window.require) {
            configureMonaco(window.require, resolve, reject);
            return;
          }

          const script = document.createElement('script');
          script.src = '/monaco/vs/loader.js';
          script.onload = () => configureMonaco(window.require, resolve, reject);
          script.onerror = () => reject(new Error('Failed to load Monaco assets'));
          document.head.appendChild(script);
        });

        return monacoPromise;
      }

      function configureMonaco(requireFn, resolve, reject) {
        requireFn.config({ paths: { vs: '/monaco/vs' } });
        requireFn(['vs/editor/editor.main'], () => {
          const monaco = window.monaco;
          const languageId = 'warm-trace';

          monaco.languages.register({ id: languageId });
          monaco.languages.setLanguageConfiguration(languageId, {
            comments: {
              lineComment: '#',
            },
          });
          monaco.languages.setMonarchTokensProvider(languageId, {
            tokenizer: {
              root: [
                [/^#region.*$/, 'keyword'],
                [/^#endregion.*$/, 'keyword'],
                [/^(command|gate|note|result):/, 'type'],
                [/\b(run|plan|tool|result)\b/, 'keyword'],
              ],
            },
          });
          monaco.languages.registerFoldingRangeProvider(languageId, {
            provideFoldingRanges(model) {
              const ranges = [];
              const stack = [];

              for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
                const line = model.getLineContent(lineNumber).trim();

                if (line.startsWith('#region')) {
                  stack.push(lineNumber);
                } else if (line.startsWith('#endregion')) {
                  const start = stack.pop();

                  if (start) {
                    ranges.push({
                      end: lineNumber,
                      kind: monaco.languages.FoldingRangeKind.Region,
                      start,
                    });
                  }
                }
              }

              return ranges;
            },
          });

          resolve(monaco);
        }, reject);
      }

      async function ensureEditor() {
        if (!monacoRootEl) {
          return;
        }

        if (editor) {
          return;
        }

        if (!editorPromise) {
          editorPromise = (async () => {
            const monaco = await loadMonaco();

            if (editor) {
              return;
            }

            monacoRootEl.textContent = '';
            model = monaco.editor.createModel(renderTrace(), 'warm-trace');
            editor = monaco.editor.create(monacoRootEl, {
              automaticLayout: true,
              fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
              fontSize: 14,
              glyphMargin: false,
              lineNumbers: 'off',
              minimap: { enabled: false },
              model,
              readOnly: true,
              renderLineHighlight: 'none',
              scrollBeyondLastLine: false,
              stickyScroll: { enabled: false },
              theme: 'vs',
              wordWrap: 'off',
            });
          })();
        }

        await editorPromise;
      }

      function setDepth(nextDepth) {
        currentDepth = nextDepth;
        renderIntoEditor();
      }

      function resetSession() {
        clearTimers();
        session = null;
        currentRevision = null;
        renderIntoEditor();
      }

      function startRun(payload) {
        clearTimers();
        currentRevision = payload.revision;
        session = {
          solved: true,
          summary: payload.summary || 'run(app) -> ok',
        };
        renderIntoEditor();
      }

      function createNode(title, lines) {
        return {
          children: [],
          closed: false,
          lines,
          title,
        };
      }

      function queueEvent(delay, callback) {
        const timerId = window.setTimeout(callback, delay);
        runTimers.push(timerId);
      }

      function clearTimers() {
        for (const timerId of runTimers) {
          window.clearTimeout(timerId);
        }

        runTimers = [];
      }

      function renderTrace() {
        if (!session) {
          return [
            '#region run(app) blocked',
            '  note: waiting for the shell to send a valid run_app command',
            '#endregion',
          ].join('\\n');
        }

        if (session.solved) {
          return 'Gut gemacht';
        }

        const lines = [];
        renderNode(session.root, 0, currentDepth, lines);
        return lines.join('\\n');
      }

      function renderNode(node, depth, maxDepth, lines) {
        if (depth > maxDepth) {
          return;
        }

        const indent = '  '.repeat(depth);
        const status = node.closed ? 'ok' : '...';

        lines.push(indent + '#region ' + node.title.replace('-> ok', '-> ' + status));

        for (const line of node.lines) {
          lines.push(indent + '  ' + line);
        }

        if (depth < maxDepth) {
          for (const child of node.children) {
            renderNode(child, depth + 1, maxDepth, lines);
          }
        }

        lines.push(indent + '#endregion');
      }

      async function renderIntoEditor() {
        await ensureEditor();

        if (!model) {
          return;
        }

        const nextValue = renderTrace();

        if (model.getValue() !== nextValue) {
          model.setValue(nextValue);
        }
      }

      function onMessage(event) {
        const message = event.data;

        if (!message || message.source !== 'tk-command-bridge' || message.type !== 'command-state') {
          return;
        }

        const payload = message.payload;

        if (!payload || typeof payload !== 'object') {
          return;
        }

        if (!payload.valid) {
          resetSession();
          return;
        }

        if (payload.revision === currentRevision) {
          return;
        }

        startRun(payload);
      }

      function moveDepth(direction) {
        const currentIndex = depthOrder.indexOf(currentDepth);
        const nextIndex = Math.max(0, Math.min(depthOrder.length - 1, currentIndex + direction));
        setDepth(depthOrder[nextIndex]);
      }

      window.addEventListener('keydown', (event) => {
        if (event.key === '[') {
          event.preventDefault();
          moveDepth(-1);
        }

        if (event.key === ']') {
          event.preventDefault();
          moveDepth(1);
        }
      });

      window.addEventListener('message', onMessage);
      window.addEventListener('beforeunload', () => {
        clearTimers();
        editor?.dispose();
        model?.dispose();
        editorPromise = null;
      });

      setDepth(99);
      renderIntoEditor().catch((error) => {
        if (model) {
          model.setValue(String(error));
        }
      });
    </script>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');

  if (url.pathname.startsWith('/monaco/')) {
    const relativePath = decodeURIComponent(url.pathname.slice('/monaco/'.length));
    const assetPath = resolve(monacoRoot, relativePath);

    if (!isInside(monacoRoot, assetPath)) {
      sendText(response, 'Invalid asset path', 403);
      return;
    }

    await serveFile(response, assetPath);
    return;
  }

  sendText(response, renderPage(), 200, 'text/html; charset=utf-8');
});

server.listen(port, host, () => {
  console.log('goose-trace preview listening on http://%s:%d', host, port);
});
