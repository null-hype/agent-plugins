const { createServer } = require('node:http');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve, sep } = require('node:path');

const host = '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const workspaceRoot = process.cwd();
const inputPath = resolve(workspaceRoot, 'warm-log.txt');
const monacoRoot = resolve(workspaceRoot, 'node_modules', 'monaco-editor', 'min');

function send(response, body, statusCode = 200, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

function isInside(basePath, targetPath) {
  return targetPath === basePath || targetPath.startsWith(`${basePath}${sep}`);
}

async function readInput() {
  try {
    return await readFile(inputPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readRequestBody(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000) {
      throw new Error('Warm Log input is too large');
    }
  }

  return body;
}

async function serveMonaco(response, pathname) {
  const relativePath = decodeURIComponent(pathname.slice('/monaco/'.length));
  const assetPath = resolve(monacoRoot, relativePath);

  if (!isInside(monacoRoot, assetPath)) {
    send(response, 'Invalid asset path', 403);
    return;
  }

  try {
    const body = await readFile(assetPath);
    const contentType = assetPath.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : assetPath.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : assetPath.endsWith('.ttf')
          ? 'font/ttf'
          : 'application/octet-stream';

    send(response, body, 200, contentType);
  } catch (error) {
    send(response, error && error.code === 'ENOENT' ? 'Not found' : 'Unable to load asset', error && error.code === 'ENOENT' ? 404 : 500);
  }
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Warm Log</title>
    <style>
      * { box-sizing: border-box; }
      html, body, main, #monaco-root { width: 100%; height: 100%; margin: 0; }
      body { overflow: hidden; background: #fffdf8; }
    </style>
  </head>
  <body>
    <main><div id="monaco-root"></div></main>
    <script>
      const root = document.getElementById('monaco-root');
      let applyingExternalValue = false;
      let lastFileValue = '';
      let saveTimer = null;

      async function loadInput() {
        const response = await fetch('/__tk/input', { cache: 'no-store' });
        return response.ok ? response.text() : '';
      }

      async function saveInput(value) {
        const response = await fetch('/__tk/input', {
          method: 'PUT',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          body: value,
        });

        if (!response.ok) {
          throw new Error('Unable to save Warm Log input');
        }
      }

      const loader = document.createElement('script');
      loader.src = '/monaco/vs/loader.js';
      loader.onload = async () => {
        window.require.config({ paths: { vs: '/monaco/vs' } });
        window.require(['vs/editor/editor.main'], async () => {
          lastFileValue = await loadInput();
          const model = window.monaco.editor.createModel(lastFileValue, 'plaintext');
          const editor = window.monaco.editor.create(root, {
            ariaLabel: 'Warm Log input',
            automaticLayout: true,
            fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Consolas, monospace',
            fontSize: 14,
            glyphMargin: false,
            lineDecorationsWidth: 12,
            lineNumbers: 'off',
            minimap: { enabled: false },
            model,
            padding: { top: 16, bottom: 16 },
            readOnly: false,
            renderLineHighlight: 'none',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
          });

          editor.focus();

          model.onDidChangeContent(() => {
            if (applyingExternalValue) {
              return;
            }

            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(async () => {
              saveTimer = null;
              const value = model.getValue();
              await saveInput(value);
              lastFileValue = value;
            }, 150);
          });

          window.setInterval(async () => {
            if (saveTimer !== null) {
              return;
            }

            const value = await loadInput();
            if (value !== lastFileValue && value !== model.getValue()) {
              applyingExternalValue = true;
              model.setValue(value);
              applyingExternalValue = false;
            }
            lastFileValue = value;
          }, 300);
        });
      };
      root.appendChild(loader);
    </script>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');

  if (url.pathname === '/__tk/input') {
    try {
      if (request.method === 'PUT') {
        await writeFile(inputPath, await readRequestBody(request), 'utf8');
        send(response, '');
        return;
      }

      send(response, await readInput());
    } catch (error) {
      send(response, error instanceof Error ? error.message : 'Unable to access Warm Log input', 500);
    }
    return;
  }

  if (url.pathname.startsWith('/monaco/')) {
    await serveMonaco(response, url.pathname);
    return;
  }

  send(response, renderPage(), 200, 'text/html; charset=utf-8');
});

server.listen(port, host, () => {
  console.log('Warm Log input listening on http://%s:%d', host, port);
});
