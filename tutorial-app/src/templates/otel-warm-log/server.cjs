const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname, resolve, sep } = require('node:path');

const host = '0.0.0.0';
const port = Number(process.env.PORT || 4173);
const workspaceRoot = process.cwd();
const monacoRoot = resolve(workspaceRoot, 'node_modules', 'monaco-editor', 'min');

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

function resolveWorkspaceFile(requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return null;
  }

  const normalizedPath = requestedPath.startsWith('/') ? `.${requestedPath}` : requestedPath;
  const filePath = resolve(workspaceRoot, normalizedPath);

  if (!isInside(workspaceRoot, filePath)) {
    return null;
  }

  return filePath;
}

async function serveJsonFile(response, requestedPath) {
  const filePath = resolveWorkspaceFile(requestedPath);

  if (!filePath) {
    sendText(response, 'Invalid file path', 403);
    return;
  }

  try {
    const fileContents = await readFile(filePath, 'utf8');

    // CIT-149's reason-log fixture is JSON Lines (one resolved-reason
    // record per line), not a single JSON document -- the issue's own
    // scope explicitly rules out inventing a new file format for this, so
    // this validates line-by-line instead of adding a second endpoint.
    if (extname(filePath) === '.jsonl') {
      for (const line of fileContents.split('\n')) {
        if (line.trim()) {
          JSON.parse(line);
        }
      }
      sendText(response, fileContents, 200, 'application/x-ndjson; charset=utf-8');
      return;
    }

    JSON.parse(fileContents);
    sendText(response, fileContents, 200, 'application/json; charset=utf-8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendText(response, 'Not found', 404);
      return;
    }

    sendText(response, 'Unable to load story', 500);
  }
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OTel Warm Log Template</title>
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
      const fallbackStory = {
        blocked: {
          title: 'trace otel.opentrader.place_order blocked',
          lines: ['note: solve the grammar rule to replay the warm log'],
        },
        scenario: 'opentrader-idor',
        trace: {
          lines: [
            'actor: alice',
            'objective: place an order under bob\\'s user_id',
            'result: anomaly detected',
          ],
          spans: [],
          title: 'trace otel.opentrader.place_order -> anomaly',
        },
      };
      const fallbackLoanwordStory = {
        scenario: 'schadenfreude-admission',
        states: {
          idle: {
            lines: ['note: type an English attempt in translation.en'],
            spans: [],
            title: 'trace lexeme.loanword.translation idle',
          },
          'loanword-pending-admission': {
            lines: [
              'source.lexeme: Schadenfreude',
              'attempt.en: Schadenfreude',
              'result: preserved surface still requires PersonalVocabulary.pkl admission',
            ],
            spans: [],
            title: 'loanword(Schadenfreude) -> pending admission',
          },
          'paraphrase-loss': {
            lines: [
              'source.lexeme: loanword',
              'attempt.en: gloss',
              'result: paraphrase loses required structure before it reaches English',
            ],
            spans: [],
            title: 'trace lexeme.loanword.translation -> loss',
          },
          completed: {
            lines: [
              'status: translation.en preserved source surface',
              'surface: loanword',
              'move: you solved this by preserving the word, not paraphrasing it',
            ],
            spans: [],
            title: 'loanword(loanword) -> preserved',
          },
        },
      };

      let editor = null;
      let model = null;
      let monacoPromise = null;
      let editorPromise = null;
      let currentRevision = null;
      let currentState = null;
      let storyCache = new Map();

      // CIT-149: line -> the Diagnostic (severity, code, message) a
      // reason-log record on that line carries. Populated by
      // renderReasonLog, read by the hover provider registered below --
      // both keyed by Monaco line number so the hover content always
      // matches whatever setModelMarkers most recently underlined.
      let reasonDiagnosticsByLine = {};
      // CIT-152: line -> the same record's "related" evidence
      // (EvidenceLocation[] -- role/uri/detail, reasonDiagnosticToGovernance's
      // own output, committed verbatim into reason-log.jsonl and proven
      // equal to it by reasonResolver.spec.ts). Hover reads this to show
      // *why*, alongside the verdict reasonDiagnosticsByLine already
      // carries; the CodeLens command below reads it to render the same
      // evidence in a content widget under the line -- this bundled
      // monaco-editor build's standalone "min" AMD bundle does not
      // register the gotoSymbol/peek-definition contribution (checked
      // directly: no editor.action.peekDefinition/revealDefinition action
      // exists on a freshly created editor here), so a content widget --
      // an API this build does have -- is what actually renders the
      // "little embedded editor opens underneath" idea today, not
      // Monaco's own Peek View.
      let reasonRelatedByLine = {};
      const REASON_LOG_MARKER_OWNER = 'reason-resolver';
      const PEEK_EVIDENCE_COMMAND = 'otel-warm-log.peekReasonEvidence';
      const EVIDENCE_WIDGET_ID = 'otel-warm-log.evidenceWidget';
      let evidenceWidgetLine = null;

      function buildEvidenceDomNode(related) {
        const node = document.createElement('div');
        node.style.cssText =
          'background:#1e1e1e;color:#d4d4d4;border:1px solid #454545;border-radius:3px;' +
          'padding:6px 10px;font:12px "Roboto Mono",Menlo,Consolas,monospace;max-width:640px;white-space:pre-wrap;';

        related.forEach((entry) => {
          const row = document.createElement('div');
          row.textContent = entry.role + ' (' + entry.uri + '): ' + entry.detail;
          row.style.padding = '2px 0';
          node.appendChild(row);
        });

        return node;
      }

      // Toggles a content widget (Monaco's own contentWidgets API, always
      // available regardless of which language contributions this bundle
      // registers) directly under "lineNumber", rendering that line's
      // "related" evidence. Clicking the same line's lens again hides it.
      function toggleEvidenceWidget(monacoEditor, lineNumber, related) {
        if (evidenceWidgetLine !== null) {
          monacoEditor.removeContentWidget({ getId: () => EVIDENCE_WIDGET_ID });
          const wasShowingThisLine = evidenceWidgetLine === lineNumber;
          evidenceWidgetLine = null;
          if (wasShowingThisLine) {
            return;
          }
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
          const languageId = 'otel-warm-log';

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
                [/^(actor|objective|result|service.name|http.route|enduser.id|request.body.user_id|persistence.user_id|action|status|severity|summary|source.lexeme|attempt.en|effect|move|surface|adoptedAs):/, 'type'],
                [/\b(trace|span|rule|anomaly|loanword)\b/, 'keyword'],
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

          // CIT-149: the underline (setModelMarkers) and the message on
          // hover (registerHoverProvider) -- additive to the tokenizer and
          // folding provider above, not a replacement for them. Both read
          // reasonDiagnosticsByLine rather than taking data directly, so a
          // single registration here keeps working across every
          // renderReasonLog call that repopulates it.
          //
          // CIT-152 widens the hover with reasonRelatedByLine: the
          // governing vocabulary entry, grant, or fact file the verdict
          // was actually computed from, not just the verdict's own code
          // and message.
          monaco.languages.registerHoverProvider(languageId, {
            provideHover(hoverModel, position) {
              const diagnostic = reasonDiagnosticsByLine[position.lineNumber];

              if (!diagnostic) {
                return null;
              }

              const related = reasonRelatedByLine[position.lineNumber] || [];
              const contents = [{ value: '**' + diagnostic.code + '**' }, { value: diagnostic.message }];

              for (const entry of related) {
                contents.push({ value: '_' + entry.role + '_ (' + entry.uri + '): ' + entry.detail });
              }

              return {
                range: new monaco.Range(
                  position.lineNumber,
                  1,
                  position.lineNumber,
                  hoverModel.getLineMaxColumn(position.lineNumber),
                ),
                contents,
              };
            },
          });

          // CIT-152: the CodeLens is the high-level verdict, clickable
          // and visually separate from the underlined text itself --
          // "Markers should represent actual disagreements... CodeLens is
          // probably best for the high-level governance verdict" from
          // this issue's own discussion. Its command toggles the same
          // related evidence the hover above already exposes, rendered as
          // a content widget under the line (see toggleEvidenceWidget's
          // own comment for why that, and not Peek, is what actually
          // shows here).
          // configureMonaco only ever runs once per page load (loadMonaco
          // caches it behind monacoPromise), so this command is
          // registered exactly once -- Monaco throws on a duplicate
          // registration.
          monaco.editor.registerCommand(PEEK_EVIDENCE_COMMAND, (_accessor, lineNumber) => {
            if (!editor) {
              return;
            }

            const related = reasonRelatedByLine[lineNumber] || [];

            if (related.length === 0) {
              return;
            }

            editor.setPosition({ column: 1, lineNumber });
            toggleEvidenceWidget(editor, lineNumber, related);
          });

          monaco.languages.registerCodeLensProvider(languageId, {
            provideCodeLenses(lensModel) {
              const lenses = [];

              for (let lineNumber = 1; lineNumber <= lensModel.getLineCount(); lineNumber += 1) {
                const diagnostic = reasonDiagnosticsByLine[lineNumber];

                if (!diagnostic) {
                  continue;
                }

                const relatedCount = (reasonRelatedByLine[lineNumber] || []).length;

                lenses.push({
                  range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                  command: {
                    id: PEEK_EVIDENCE_COMMAND,
                    title: '✗ ' + diagnostic.code + ' · ' + relatedCount + ' related',
                    arguments: [lineNumber],
                  },
                });
              }

              return { lenses, dispose() {} };
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
            model = monaco.editor.createModel(renderTrace().text, 'otel-warm-log');
            editor = monaco.editor.create(monacoRootEl, {
              automaticLayout: true,
              folding: true,
              fontFamily: '"Roboto Mono", "SFMono-Regular", Menlo, Consolas, monospace',
              fontSize: 13,
              glyphMargin: true,
              lineDecorationsWidth: 12,
              lineNumbers: 'on',
              lineNumbersMinChars: 2,
              minimap: { enabled: false },
              model,
              padding: { top: 16, bottom: 24 },
              readOnly: true,
              renderLineHighlight: 'none',
              scrollBeyondLastLine: false,
              showFoldingControls: 'always',
              stickyScroll: { enabled: false },
              theme: 'vs',
              wordWrap: 'on',
            });
          })();
        }

        await editorPromise;
      }

      async function loadStory(storyFile, fallback) {
        const filePath = storyFile || '/trace-story.json';

        if (storyCache.has(filePath)) {
          return storyCache.get(filePath);
        }

        try {
          const response = await fetch('/__tk/file?path=' + encodeURIComponent(filePath), {
            cache: 'no-store',
          });

          if (!response.ok) {
            throw new Error('Failed to fetch story');
          }

          const story = await response.json();
          storyCache.set(filePath, story);
          return story;
        } catch (_error) {
          storyCache.set(filePath, fallback);
          return fallback;
        }
      }

      function getPreviewMode(payload) {
        return payload && payload.previewMode === 'static-log-with-completion'
          ? 'static-log-with-completion'
          : 'blocked-until-valid';
      }

      function getFallbackForMode(previewMode) {
        return previewMode === 'static-log-with-completion' ? fallbackLoanwordStory : fallbackStory;
      }

      async function applyLessonState(payload) {
        const previewMode = getPreviewMode(payload);
        const revision =
          payload && typeof payload.revision === 'number' ? payload.revision : Date.now();
        const solved =
          payload && typeof payload.solved === 'boolean'
            ? payload.solved
            : Boolean(payload && payload.valid);
        const fallback = getFallbackForMode(previewMode);
        currentRevision = revision;

        const nextState = {
          previewMode,
          previewState:
            payload && typeof payload.previewState === 'string'
              ? payload.previewState
              : solved
                ? 'completed'
                : 'idle',
          scenario: payload && payload.scenario ? payload.scenario : fallback.scenario,
          solved,
          story: null,
          storyFile:
            payload && payload.storyFile
              ? payload.storyFile
              : previewMode === 'static-log-with-completion'
                ? '/warm-log-story.json'
                : '/trace-story.json',
          summary:
            payload && payload.summary
              ? payload.summary
              : getFallbackSummary(previewMode, fallback, solved),
        };

        if (previewMode === 'static-log-with-completion' || solved) {
          nextState.story = await loadStory(nextState.storyFile, fallback);
        }

        if (currentRevision !== revision) {
          return;
        }

        currentState = nextState;
        await renderIntoEditor();
      }

      function renderTrace() {
        if (!currentState) {
          return {
            collapsedLines: [],
            text: [
              '#region ' + fallbackStory.blocked.title,
              ...fallbackStory.blocked.lines.map((line) => '  ' + line),
              '#endregion',
            ].join('\\n'),
          };
        }

        const previewMode = currentState.previewMode || 'blocked-until-valid';
        const fallback = getFallbackForMode(previewMode);
        const story = currentState.story || fallback;

        if (currentState.scenario && story.scenario && currentState.scenario !== story.scenario) {
          return {
            collapsedLines: [],
            text: [
              '#region scenario mismatch',
              '  note: preview scenario does not match the requested lesson state',
              '#endregion',
            ].join('\\n'),
          };
        }

        if (previewMode === 'static-log-with-completion') {
          const node = getStaticNode(story, fallback, currentState.previewState, currentState.solved);
          const lines = [];
          const collapsedLines = [];
          renderNode(node, 0, lines, collapsedLines);
          return {
            collapsedLines,
            text: lines.join('\\n'),
          };
        }

        if (!currentState.solved) {
          const blocked = story.blocked || fallback.blocked;
          return {
            collapsedLines: [],
            text: [
              '#region ' + blocked.title,
              ...blocked.lines.map((line) => '  ' + line),
              '#endregion',
            ].join('\\n'),
          };
        }

        const lines = [];
        const collapsedLines = [];
        renderNode(story.trace || fallback.trace, 0, lines, collapsedLines);
        return {
          collapsedLines,
          text: lines.join('\\n'),
        };
      }

      function getFallbackSummary(previewMode, fallback, solved) {
        if (previewMode === 'static-log-with-completion') {
          const states = fallback.states || {};
          const node = solved ? states.completed : states['paraphrase-loss'] || states.idle;
          return node ? node.title : 'loanword lesson';
        }

        return solved ? fallback.trace.title : fallback.blocked.title;
      }

      function getStaticNode(story, fallback, previewState, solved) {
        if (story.states || fallback.states) {
          const storyStates = story.states || {};
          const fallbackStates = fallback.states || {};
          const stateKey = previewState || (solved ? 'completed' : 'idle');

          return (
            storyStates[stateKey] ||
            fallbackStates[stateKey] ||
            (solved ? storyStates.completed || fallbackStates.completed : undefined) ||
            storyStates['paraphrase-loss'] ||
            fallbackStates['paraphrase-loss'] ||
            storyStates.idle ||
            fallbackStates.idle
          );
        }

        return solved ? story.completion || fallback.completion : story.log || fallback.log;
      }

      function renderNode(node, depth, lines, collapsedLines) {
        const indent = '  '.repeat(depth);
        const startLine = lines.length + 1;
        lines.push(indent + '#region ' + node.title);

        if (node.startsCollapsed) {
          collapsedLines.push(startLine);
        }

        for (const line of node.lines || []) {
          lines.push(indent + '  ' + line);
        }

        for (const child of node.spans || []) {
          renderNode(child, depth + 1, lines, collapsedLines);
        }

        lines.push(indent + '#endregion');
      }

      async function applyCollapsedLines(lineNumbers) {
        if (!editor || !lineNumbers.length) {
          return;
        }

        const unfoldAll = editor.getAction('editor.unfoldAll');

        if (unfoldAll) {
          try {
            await unfoldAll.run();
          } catch (_error) {
            // Ignore missing unfold support in Monaco internals.
          }
        }

        for (const lineNumber of lineNumbers) {
          editor.setPosition({ column: 1, lineNumber });
          editor.revealLineInCenterIfOutsideViewport(lineNumber);

          const fold = editor.getAction('editor.fold');

          if (fold) {
            try {
              await fold.run();
            } catch (_error) {
              // Ignore missing fold support in Monaco internals.
            }
          }
        }

        editor.setPosition({ column: 1, lineNumber: 1 });
        editor.revealLine(1);
      }

      async function renderIntoEditor() {
        await ensureEditor();

        if (!model) {
          return;
        }

        const rendered = renderTrace();
        const nextValue = rendered.text;
        const changed = model.getValue() !== nextValue;

        if (changed) {
          model.setValue(nextValue);
        }

        if (editor && changed && rendered.collapsedLines.length > 0) {
          window.setTimeout(() => {
            applyCollapsedLines(rendered.collapsedLines).catch(() => {});
          }, 0);
        }
      }

      // CIT-149: a reason-log.jsonl fixture is an independent, static
      // rendering path -- it does not go through applyLessonState/
      // renderTrace or the lesson-state postMessage protocol those use,
      // because this demo has no worker input loop to drive: the log is
      // fixed, the point is what hovering an already-failed line shows.
      // A lesson with no reason-log.jsonl (every existing chapter-1
      // lesson) gets a 404 here and falls through to the fallback trace
      // rendered above, unchanged.
      async function loadReasonLog() {
        try {
          const response = await fetch('/__tk/file?path=/reason-log.jsonl', { cache: 'no-store' });

          if (!response.ok) {
            return null;
          }

          const text = await response.text();
          return text
            .split('\\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        } catch (_error) {
          return null;
        }
      }

      async function renderReasonLog(records) {
        await ensureEditor();

        if (!model) {
          return;
        }

        const lines = [];
        const markers = [];
        reasonDiagnosticsByLine = {};
        reasonRelatedByLine = {};

        if (evidenceWidgetLine !== null) {
          editor.removeContentWidget({ getId: () => EVIDENCE_WIDGET_ID });
          evidenceWidgetLine = null;
        }

        records.forEach((record, index) => {
          const lineNumber = index + 1;
          lines.push(typeof record.raw === 'string' ? record.raw : '');

          if (record.diagnostic) {
            reasonDiagnosticsByLine[lineNumber] = record.diagnostic;
            markers.push({
              startLineNumber: lineNumber,
              startColumn: 1,
              endLineNumber: lineNumber,
              endColumn: Math.max(2, lines[lines.length - 1].length + 1),
              severity:
                record.diagnostic.severity === 'error'
                  ? window.monaco.MarkerSeverity.Error
                  : window.monaco.MarkerSeverity.Warning,
              message: record.diagnostic.message,
              code: record.diagnostic.code,
            });

            // CIT-152: "related" is reasonDiagnosticToGovernance's own
            // output, committed into reason-log.jsonl and proven equal to
            // it -- read by the hover provider and by the CodeLens
            // command's evidence widget above.
            if (Array.isArray(record.related) && record.related.length > 0) {
              reasonRelatedByLine[lineNumber] = record.related;
            }
          }
        });

        model.setValue(lines.join('\\n'));
        window.monaco.editor.setModelMarkers(model, REASON_LOG_MARKER_OWNER, markers);
      }

      function onMessage(event) {
        if (event.source !== window.parent) return;
        const message = event.data;

        if (
          !message ||
          message.type !== 'lesson-state' ||
          !['tk-loanword-arc-bridge', 'tk-rule-trace-bridge'].includes(message.source)
        ) {
          return;
        }

        const payload = message.payload;

        if (!payload || typeof payload !== 'object') {
          return;
        }

        if (
          typeof payload.revision === 'number' &&
          typeof currentRevision === 'number' &&
          payload.revision <= currentRevision
        ) {
          return;
        }

        applyLessonState(payload).catch((error) => {
          if (model) {
            model.setValue(String(error));
          }
        });
      }

      window.addEventListener('message', onMessage);
      window.parent.postMessage({
        type: 'lesson-preview-ready',
        source: 'tk-warm-log-preview',
      }, '*');
      window.addEventListener('beforeunload', () => {
        editor?.dispose();
        model?.dispose();
        editorPromise = null;
      });

      currentState = {
        previewMode: 'blocked-until-valid',
        scenario: fallbackStory.scenario,
        solved: false,
        story: null,
        storyFile: '/trace-story.json',
        summary: fallbackStory.blocked.title,
      };
      renderIntoEditor().catch(() => {});

      loadReasonLog().then((records) => {
        if (records && records.length > 0) {
          renderReasonLog(records).catch(() => {});
        }
      });
    </script>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');

  if (url.pathname === '/__tk/file') {
    await serveJsonFile(response, url.searchParams.get('path'));
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

  sendText(response, renderPage(), 200, 'text/html; charset=utf-8');
});

server.listen(port, host, () => {
  console.log('otel-warm-log preview listening on http://%s:%d', host, port);
});
