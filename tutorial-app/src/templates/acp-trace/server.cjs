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

// CIT-251: the Agent pane is a UI over the agent's reasoning -- what it holds
// fixed, what it has concluded, and why a conclusion changed (the recorded
// grant). The Client pane stays what a client sees of the session: the log.
// The reasoning view replaces the raw-envelope dump whenever the trace
// carries reasoning (pins or verdicts); a trace without any, like the
// ghost-trace lessons, still shows its envelopes. Only the Budget channel
// uses pass/fail colour; Type, Merge and Authority share one neutral style so
// none of them reads as an approval.
function reasoningViewStyles() {
  return `<style>
      #trace-view { width: 100%; height: 100%; overflow: auto; font: 11.5px/1.3 system-ui, sans-serif; color: #2b2a26; padding: 5px 8px; background: #faf7ef; }
      #trace-view[hidden], main.agent.reasoning #monaco-root { display: none; }
      #trace-view h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; margin: 0; color: #6f6a5c; }
      #trace-view ul { list-style: none; margin: 0; padding: 0; }
      #trace-view .pins ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); column-gap: 12px; }
      #trace-view .pins li { margin: 0; padding-left: 4px; border-left: 3px solid transparent; }
      #trace-view .pins .label { font-weight: 600; }
      #trace-view .pins .text, #trace-view .entry { font-family: "Roboto Mono", Menlo, Consolas, monospace; }
      #trace-view .tag { display: inline-block; margin-left: 5px; padding: 0 3px; line-height: 1.25; border-radius: 3px; border: 1px solid #b9b2a0; color: #5b5646; font: 10.5px system-ui, sans-serif; }
      #trace-view .channels { display: grid; gap: 2px; margin-top: 5px; }
      #trace-view .channel { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: start; gap: 4px; }
      #trace-view .channel h2 { padding-top: 2px; }
      #trace-view .entry { padding: 1px 4px; margin: 0 0 2px; border-radius: 3px; border-left: 3px solid transparent; color: #2b2a26; background: #f0ede4; }
      #trace-view .entry.older { opacity: .8; }
      #trace-view .entry[data-channel="budget"][data-status="fail"] { color: #8c1d18; background: #fde8e6; }
      #trace-view .entry[data-channel="budget"][data-status="pass"] { color: #17572a; background: #e4f4e8; }
      #trace-view .entry .caption { display: block; font-family: system-ui, sans-serif; font-weight: 600; }
      #trace-view .empty { color: #8a8575; font-style: italic; padding: 2px 0; }
      #trace-view .latest { border-left-color: #3b6fd4; }
    </style>`;
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
  <style>
      main.client { display: flex; flex-direction: column; }
      main.client #monaco-root { flex: 1 1 auto; min-height: 72px; height: auto; }
      #scripted { flex: 0 0 auto; font: 600 11.5px/1.35 system-ui, sans-serif; color: #6b5d2e; padding: 4px 8px; border-bottom: 1px solid #d8d4c8; background: #faf7ef; }
      #scripted[hidden] { display: none; }
    </style>
  <body>
    <main class="client"><div id="scripted" hidden></div><div id="monaco-root"></div></main>
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
          tokenizer: {
            root: [
              [/^(client|agent): .*$/, 'keyword'],
              [/^pick .*$/, 'keyword'],
              [/^#.*$/, 'comment'],
            ],
          },
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

      // CIT-251: the newest turn (and the pending line naming who acts next)
      // is what a viewer needs; in a short preview pane it would otherwise sit
      // below the fold. Re-run on layout changes too: the scripted line above
      // the log appears after a render, shrinking the editor after the first reveal.
      function revealNewest() {
        if (editor && model) editor.revealLine(model.getLineCount());
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
        editor.onDidLayoutChange(revealNewest);
      }

      // Mirrors acpTraceProtocol.ts's metaOf / describeActor / extractPromptText /
      // toWarmLogLine / describePendingLine -- those are the unit-tested
      // originals; see renderClientPage's comment on why a copy.
      function metaOf(envelope) {
        if (envelope.result && envelope.result._meta) return envelope.result._meta;
        if (envelope.params && typeof envelope.params === 'object' && envelope.params._meta) return envelope.params._meta;
        return undefined;
      }

      function describeActor(turn) {
        return turn.speaker ? turn.speaker + ' (' + turn.actor + ')' : turn.actor;
      }

      function extractPromptText(params) {
        if (!params || typeof params !== 'object') return null;
        const toolCall = params.toolCall || params.update;
        if (toolCall && typeof toolCall.title === 'string') return toolCall.title;
        if (!Array.isArray(params.prompt)) return null;
        const texts = params.prompt
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text);
        return texts.length > 0 ? texts.join(' ') : null;
      }

      function toWarmLogLine(frame) {
        const envelope = frame.envelope || {};
        const meta = metaOf(envelope);
        const diagnostic = meta && meta.diagnostic;
        const promptText = extractPromptText(envelope.params);
        const status = diagnostic ? diagnostic.code : envelope.result !== undefined ? 'ok' : 'sent';
        const call = envelope.method ? envelope.method + (promptText ? ' "' + promptText + '"' : '') : null;
        return {
          raw: [describeActor(frame) + ': ' + frame.action, '->', status, call].filter(Boolean).join('  '),
          diagnostic: diagnostic ? { severity: diagnostic.severity, code: diagnostic.code, message: diagnostic.message } : null,
          related: (diagnostic && diagnostic.related) || [],
        };
      }

      function describePendingLine(nextTurn) {
        return describeActor(nextTurn) + ': ' + nextTurn.action + '  ->  awaiting recorded turn (Solve replays it)';
      }

      function renderRecords(state) {
        if (!state || !state.frames || state.frames.length === 0) {
          return [{ raw: 'waiting for trace: no frames received yet', diagnostic: null, related: [] }];
        }
        const records = state.frames.map(toWarmLogLine);
        if (state.nextTurn) {
          records.push({ raw: describePendingLine(state.nextTurn), diagnostic: null, related: [] });
        }
        return records;
      }

      // A git rebase -i todo buffer instead of a session log: the frame
      // that most recently carried a rebaseTodo block (newest first) is
      // the buffer as it stands -- squashing/rewriting replaces it wholesale,
      // it doesn't append, the same way an actual rebase-todo file does. If
      // no later frame supersedes it, the buffer stays byte-for-byte the
      // same -- that's the point for this scenario's third turn: the thing a
      // reviewer would be staring at in vim never changes, because nothing
      // about a rebase-todo file can show runtime behavior.
      function latestRebaseTodo(frames) {
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          if (frames[i].rebaseTodo) return frames[i].rebaseTodo;
        }
        return null;
      }

      function renderRebaseTodoRecords(state) {
        const todo = state && state.frames ? latestRebaseTodo(state.frames) : null;
        if (!todo || !todo.commits || todo.commits.length === 0) {
          return [{ raw: 'waiting for trace: no commits picked yet', diagnostic: null, related: [] }];
        }
        const lines = todo.commits.map((commit) => 'pick ' + commit.sha + ' ' + commit.subject);
        if (todo.comment) {
          lines.push('');
          lines.push('# ' + todo.comment);
        }
        return lines.map((raw) => ({ raw, diagnostic: null, related: [] }));
      }

      // A scripted replay says so above the log, whichever pane the viewer reads.
      function renderScripted(state) {
        const root = document.getElementById('scripted');
        const frame = ((state && state.frames) || []).find((f) => f.provenance && f.provenance.scripted);
        root.hidden = !frame;
        root.textContent = frame ? 'Scripted replay (' + frame.provenance.scripted + ') · not a live capture' : '';
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
        revealNewest();
      }

      async function applyState(payload) {
        if (typeof payload.revision === 'number' && payload.revision === currentRevision) return;
        currentRevision = payload.revision;
        renderScripted(payload);
        const records = payload.scenario === 'smuggling-v1' ? renderRebaseTodoRecords(payload) : renderRecords(payload);
        await renderIntoEditor(records);
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

// The agent-side pane: the agent's reasoning when the trace carries it (see
// reasoningViewStyles), otherwise the raw ACP JSON-RPC envelopes as the agent
// process would actually see/emit them.
function renderAgentPage() {
  return `${sharedHead('ACP Trace: Agent')}
  ${reasoningViewStyles()}
  <body>
    <main class="agent"><section id="trace-view" aria-label="Agent reasoning" hidden></section><div id="monaco-root"></div></main>
    <script>
      ${monacoLoaderScript()}

      // Mirrors acpTraceProtocol.ts's metaOf / deriveTraceView -- the
      // unit-tested originals; see renderClientPage's comment on why a copy.
      // Display-only additions here (the \`latest\` marker, current-only
      // non-budget channels) are covered by the budget-authority storyboard,
      // not by those unit tests.
      function metaOf(envelope) {
        if (envelope.result && envelope.result._meta) return envelope.result._meta;
        if (envelope.params && typeof envelope.params === 'object' && envelope.params._meta) return envelope.params._meta;
        return undefined;
      }

      // Channels start as this fixed set (in this order, for a stable
      // layout across the lessons that use them) but are not limited to
      // it: a verdict names its own channel, and any channel not in this
      // set still gets its own section -- appended after, in first-seen
      // order -- rather than being silently dropped. Every lesson so far
      // (ghost-trace, budget-authority) only ever produces these four; the
      // smuggling scenario is the first to name its own ("review",
      // "smuggling"), which is what exposed the fixed-set version of this
      // dropping every verdict on the floor while still rendering pins.
      const KNOWN_CHANNELS = ['type', 'merge', 'budget', 'authority'];

      function deriveTraceView(frames) {
        const pins = [];
        const channels = {};
        for (const frame of frames || []) {
          const meta = metaOf(frame.envelope || {});
          const latest = frame === frames[frames.length - 1];
          for (const pin of (meta && meta.pins) || []) {
            // acpTraceProtocol.ts throws here; a page can't, so it says so.
            if (pins.some((existing) => existing.id === pin.id)) {
              pins.push({ id: pin.id + '#repinned', label: pin.label, text: 'fixture error: "' + pin.id + '" pinned twice; pinned objects are immutable', latest });
              continue;
            }
            pins.push(Object.assign({ latest }, pin));
          }
          if (meta && meta.verdict) {
            const channel = meta.verdict.channel;
            if (!channels[channel]) channels[channel] = [];
            channels[channel].push(Object.assign({ latest }, meta.verdict));
          }
        }
        for (const grant of channels.authority || []) {
          const supersededBy = { pin: grant.to, scope: grant.scope, actor: grant.actor };
          for (const pin of pins) if (pin.id === grant.from) pin.supersededBy = supersededBy;
          for (const entry of channels.budget || []) {
            if (entry.rule === grant.from && entry.subject === grant.scope) entry.supersededBy = supersededBy;
            if (entry.rule === grant.to && entry.subject !== grant.scope) entry.outOfScope = { scope: grant.scope, actor: grant.actor };
          }
        }
        const order = KNOWN_CHANNELS.concat(Object.keys(channels).filter((channel) => !KNOWN_CHANNELS.includes(channel)));
        return { pins, channels, order };
      }

      const CHANNEL_TITLES = { type: 'Type', merge: 'Merge', budget: 'Budget', authority: 'Authority' };
      const titleOf = (channel) => CHANNEL_TITLES[channel] || channel.charAt(0).toUpperCase() + channel.slice(1);

      function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      /** Renders the reasoning view; returns false when the trace carries none. */
      function renderReasoningView(state) {
        const root = document.getElementById('trace-view');
        const view = deriveTraceView(state && state.frames);
        const verdictCount = Object.values(view.channels).reduce((n, entries) => n + entries.length, 0);
        root.replaceChildren();
        if (view.pins.length === 0 && verdictCount === 0) {
          root.hidden = true;
          return false;
        }
        root.hidden = false;
        const labelOf = (id) => (view.pins.find((pin) => pin.id === id) || { label: id }).label;
        const supersededText = (by) => 'superseded for ' + labelOf(by.scope) + ' by ' + labelOf(by.pin) + ' (' + by.actor + ')';

        if (view.pins.length > 0) {
          const section = el('section', 'pins');
          section.setAttribute('role', 'region');
          section.setAttribute('aria-label', 'Fixed objects');
          const list = el('ul');
          for (const pin of view.pins) {
            const item = el('li', pin.latest ? 'latest' : '');
            item.dataset.pin = pin.id;
            item.appendChild(el('span', 'label', pin.label + ': '));
            item.appendChild(el('span', 'text', pin.text));
            if (pin.simulated) item.appendChild(el('span', 'tag simulated', 'simulated · ' + pin.simulated));
            if (pin.supersededBy) item.appendChild(el('span', 'tag superseded', supersededText(pin.supersededBy)));
            list.appendChild(item);
          }
          section.appendChild(list);
          root.appendChild(section);
        }

        const grid = el('div', 'channels');
        for (const channel of view.order) {
          const section = el('section', 'channel');
          section.setAttribute('role', 'region');
          section.setAttribute('aria-label', titleOf(channel));
          section.dataset.channel = channel;
          section.appendChild(el('h2', '', titleOf(channel)));
          // Budget keeps its whole history: an earlier evaluation must keep
          // resolving to the rule it read. The other channels (including
          // any not in KNOWN_CHANNELS) show their current state only.
          const channelEntries = view.channels[channel] || [];
          const entries = channel === 'budget' ? channelEntries : channelEntries.slice(-1);
          if (entries.length === 0) section.appendChild(el('div', 'empty', 'not evaluated'));
          const list = el('ul');
          entries.forEach((entry, index) => {
            const item = el('li', 'entry' + (index < entries.length - 1 ? ' older' : '') + (entry.latest ? ' latest' : ''), entry.text);
            item.dataset.channel = channel;
            item.dataset.status = entry.status;
            if (entry.rule) item.dataset.rule = entry.rule;
            if (channel === 'budget' && entry.rule) item.appendChild(el('span', 'tag rule', 'evaluated against ' + labelOf(entry.rule)));
            if (entry.supersededBy) item.appendChild(el('span', 'tag superseded', supersededText(entry.supersededBy)));
            if (entry.outOfScope) {
              item.appendChild(el('span', 'tag out-of-scope', 'rule granted for ' + labelOf(entry.outOfScope.scope) + ' only, not ' + labelOf(entry.subject)));
            }
            if (channel === 'authority') {
              item.appendChild(el('span', 'caption', 'Recorded ' + entry.actor + ' decision · enforcement ' + entry.enforcement));
            }
            list.appendChild(item);
          });
          section.appendChild(list);
          grid.appendChild(section);
        }
        root.appendChild(grid);
        return true;
      }

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
          .map((frame) =>
            JSON.stringify(
              frame.speaker
                ? { actor: frame.actor, speaker: frame.speaker, action: frame.action, envelope: frame.envelope }
                : { actor: frame.actor, action: frame.action, envelope: frame.envelope },
            ),
          )
          .join('\\n');
      }

      async function applyState(payload) {
        if (typeof payload.revision === 'number' && payload.revision === currentRevision) return;
        currentRevision = payload.revision;
        document.querySelector('main.agent').classList.toggle('reasoning', renderReasoningView(payload));
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
