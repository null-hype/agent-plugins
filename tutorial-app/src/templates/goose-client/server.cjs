const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, join, resolve, sep } = require('node:path');

const host = '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const exercisePath = join(process.cwd(), 'exercise.de');
const monacoRoot = resolve(process.cwd(), 'node_modules', 'monaco-editor', 'min');

function sendJson(response, body, statusCode = 200) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function sendText(response, body, statusCode = 200) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
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
      'content-type': getContentType(filePath),
      'cache-control': 'public, max-age=300',
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

async function readState() {
  try {
    const exercise = (await readFile(exercisePath, 'utf8')).trim();
    const isReady = /\bmeinem\b/i.test(exercise);

    return {
      fileFound: true,
      exercise: exercise || '(empty file)',
      status: isReady ? 'Ready' : 'Blocked',
      detail: isReady
        ? 'Lesson overlay verified. The dative fix is present.'
        : 'Preview is live. Edit /exercise.de in TutorialKit to change the preview state.',
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        fileFound: false,
        exercise: 'exercise.de was not found in the workspace root.',
        status: 'Waiting',
        detail: 'The custom template rendered, but the lesson overlay has not appeared yet.',
      };
    }

    throw error;
  }
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Goose Client Template</title>
    <style>
      :root {
        color-scheme: light;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(255, 195, 113, 0.5), transparent 30%),
          linear-gradient(180deg, #f8f1e3 0%, #efe2c8 100%);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      body {
        color: #24180a;
      }

      main {
        min-height: 100vh;
        padding: 24px;
        display: grid;
        place-items: center;
      }

      .frame {
        width: min(100%, 1180px);
        display: grid;
        gap: 20px;
        grid-template-columns: minmax(260px, 340px) minmax(360px, 1fr);
      }

      .card {
        border: 1px solid rgba(36, 24, 10, 0.12);
        border-radius: 28px;
        background: rgba(255, 251, 244, 0.9);
        box-shadow: 0 24px 60px rgba(77, 53, 24, 0.15);
        backdrop-filter: blur(14px);
      }

      .copy {
        padding: 28px;
      }

      .eyebrow {
        margin: 0 0 12px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #a85a17;
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(2rem, 5vw, 3.2rem);
        line-height: 0.95;
      }

      p {
        margin: 0;
        line-height: 1.55;
        color: rgba(36, 24, 10, 0.74);
      }

      .stack {
        display: grid;
        gap: 14px;
        margin-top: 22px;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        width: fit-content;
        padding: 10px 14px;
        border-radius: 999px;
        background: #1d7a5e;
        color: #fffdf9;
        font-size: 13px;
        font-weight: 700;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: currentColor;
        opacity: 0.9;
      }

      .workspace {
        display: grid;
        gap: 14px;
        min-height: 100%;
        padding: 24px;
      }

      .panel {
        padding: 18px;
        border-radius: 20px;
        background: rgba(36, 24, 10, 0.05);
      }

      .label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(36, 24, 10, 0.55);
      }

      .state-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 700;
        background: rgba(168, 90, 23, 0.12);
        color: #7f3f08;
      }

      .badge[data-status="Ready"] {
        background: rgba(29, 122, 94, 0.14);
        color: #16624c;
      }

      .badge[data-status="Waiting"] {
        background: rgba(83, 83, 83, 0.12);
        color: #555;
      }

      .editor-panel {
        display: grid;
        gap: 10px;
      }

      .editor-frame {
        min-height: 420px;
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid rgba(36, 24, 10, 0.12);
        background: #fffdf8;
      }

      #monaco-root {
        width: 100%;
        height: 420px;
      }

      .editor-note {
        font-size: 13px;
      }

      code {
        font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
      }

      @media (max-width: 900px) {
        .frame {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="frame">
        <section class="card copy">
          <p class="eyebrow">TutorialKit Code Template</p>
          <h1>Monaco inside the preview</h1>
          <p>
            This preview is still a real TutorialKit template, but now the lesson file is rendered
            in a read-only Monaco editor inside the preview pane.
          </p>
          <div class="stack">
            <div class="pill">
              <span class="dot"></span>
              Monaco runtime booted
            </div>
            <p id="detail">Waiting for workspace state...</p>
          </div>
        </section>

        <section class="card workspace">
          <div class="panel">
            <span class="label">Lesson Overlay State</span>
            <div class="state-row">
              <div class="badge" data-status="Waiting" id="status-badge">Waiting</div>
              <strong id="overlay-flag">Checking workspace root...</strong>
            </div>
          </div>

          <div class="panel editor-panel">
            <div>
              <span class="label">/exercise.de in Monaco</span>
              <p class="editor-note">
                This Monaco editor mirrors the lesson file from the preview app. Edit the file in the
                main TutorialKit editor to change what you see here.
              </p>
            </div>
            <div class="editor-frame">
              <div id="monaco-root"></div>
            </div>
          </div>
        </section>
      </div>
    </main>

    <script>
      const detailEl = document.getElementById('detail');
      const statusBadgeEl = document.getElementById('status-badge');
      const overlayFlagEl = document.getElementById('overlay-flag');
      const monacoRootEl = document.getElementById('monaco-root');

      let editor = null;
      let model = null;
      let monacoPromise = null;

      function loadMonaco() {
        if (monacoPromise) {
          return monacoPromise;
        }

        monacoPromise = new Promise((resolve, reject) => {
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

        return monacoPromise;
      }

      async function ensureEditor(initialValue) {
        if (editor || !monacoRootEl) {
          return;
        }

        const monaco = await loadMonaco();
        model = monaco.editor.createModel(initialValue, 'plaintext');
        editor = monaco.editor.create(monacoRootEl, {
          automaticLayout: true,
          fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          fontSize: 15,
          glyphMargin: false,
          lineNumbers: 'on',
          minimap: { enabled: false },
          model,
          readOnly: true,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          stickyScroll: { enabled: false },
          theme: 'vs',
          wordWrap: 'on',
        });
      }

      async function refreshState() {
        try {
          const response = await fetch('/__tk/state', { cache: 'no-store' });
          const state = await response.json();

          detailEl.textContent = state.detail;
          statusBadgeEl.textContent = state.status;
          statusBadgeEl.dataset.status = state.status;
          overlayFlagEl.textContent = state.fileFound
            ? 'Workspace overlay detected'
            : 'Waiting for lesson files';

          await ensureEditor(state.exercise);

          if (model && model.getValue() !== state.exercise) {
            model.setValue(state.exercise);
          }
        } catch (error) {
          detailEl.textContent = 'Preview server is alive, but Monaco state polling failed.';
          statusBadgeEl.textContent = 'Error';
          statusBadgeEl.dataset.status = 'Waiting';
          overlayFlagEl.textContent = 'Polling failed';

          await ensureEditor(String(error));

          if (model) {
            model.setValue(String(error));
          }
        }
      }

      refreshState();
      setInterval(refreshState, 1000);

      window.addEventListener('beforeunload', () => {
        editor?.dispose();
        model?.dispose();
      });
    </script>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');

  if (url.pathname === '/__tk/state') {
    try {
      sendJson(response, await readState());
    } catch (error) {
      sendJson(
        response,
        {
          fileFound: false,
          exercise: String(error),
          status: 'Error',
          detail: 'The template rendered, but reading /exercise.de failed.',
        },
        500
      );
    }

    return;
  }

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

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(renderPage());
});

server.listen(port, host, () => {
  console.log('goose-client preview listening on http://%s:%d', host, port);
});
