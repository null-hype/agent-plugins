import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef } from 'react';
import tutorialStore from 'tutorialkit:store';
import {
  buildRuleTraceState,
  parseRuleTraceRuntime,
  resolveRuleTraceConfig,
  valueToText,
} from '../lib/ruleTraceProtocol';

type DocumentRecord = Record<
  string,
  | {
      filePath: string;
      loading: boolean;
      value: string | Uint8Array;
    }
  | undefined
>;

type LessonRecord = {
  data?: {
    custom?: unknown;
  };
};

const DEFAULT_COMMAND_FILE = '/exercise.de';
const DEFAULT_RUNTIME_FILE = '/authorization-grammar.json';
const DEFAULT_STORY_FILE = '/trace-story.json';
const DEFAULT_SCENARIO = 'opentrader-idor';

interface Props {
  commandFile?: string;
  runtimeFile?: string;
  scenario?: string;
  storyFile?: string;
}

export default function RuleTraceBridge({
  commandFile = DEFAULT_COMMAND_FILE,
  runtimeFile = DEFAULT_RUNTIME_FILE,
  scenario = DEFAULT_SCENARIO,
  storyFile = DEFAULT_STORY_FILE,
}: Props) {
  const documents = useStore(tutorialStore.documents) as DocumentRecord;
  const currentDocument = useStore(tutorialStore.currentDocument) as
    | {
        filePath: string;
        loading: boolean;
        value: string | Uint8Array;
      }
    | undefined;
  const revisionRef = useRef(Date.now());
  const lesson = tutorialStore.lesson as LessonRecord | undefined;
  const resolvedConfig = useMemo(() => {
    const customConfig = resolveRuleTraceConfig(lesson?.data?.custom);

    return {
      commandFile: customConfig?.commandFile ?? commandFile,
      runtimeFile: customConfig?.runtimeFile ?? runtimeFile,
      scenario: customConfig?.scenario ?? scenario,
      storyFile: customConfig?.storyFile ?? storyFile,
    };
  }, [commandFile, lesson?.data?.custom, runtimeFile, scenario, storyFile]);

  const commandText = valueToText(documents[resolvedConfig.commandFile]?.value);
  const runtimeText = valueToText(documents[resolvedConfig.runtimeFile]?.value);
  const protocolState = useMemo(() => {
    revisionRef.current += 1;

    return buildRuleTraceState({
      revision: revisionRef.current,
      runtime: parseRuleTraceRuntime(runtimeText),
      scenario: resolvedConfig.scenario,
      storyFile: resolvedConfig.storyFile,
      text: commandText,
    });
  }, [commandText, resolvedConfig.scenario, resolvedConfig.storyFile, runtimeText]);

  useEffect(() => {
    const message = {
      payload: protocolState,
      source: 'tk-rule-trace-bridge',
      type: 'lesson-state',
    };
    const delays = [300, 900, 1600, 3200, 6400];
    const timeoutIds = delays.map((delay) =>
      window.setTimeout(() => {
        for (const frame of getPreviewFrames()) {
          frame.contentWindow?.postMessage(message, '*');
        }
      }, delay),
    );

    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [protocolState]);

  useEffect(() => {
    const isActiveFile = currentDocument?.filePath === resolvedConfig.commandFile;

    if (!isActiveFile) {
      clearRuleOverlay();
      return undefined;
    }

    return installRuleOverlay(protocolState.diagnostics);
  }, [currentDocument?.filePath, protocolState.diagnostics, protocolState.revision, resolvedConfig.commandFile]);

  return null;
}

function getPreviewFrames() {
  return Array.from(document.querySelectorAll('#previews-container iframe, .previews-container iframe')) as HTMLIFrameElement[];
}

function installRuleOverlay(diagnostics: ReturnType<typeof buildRuleTraceState>['diagnostics']) {
  clearRuleOverlay();

  if (!diagnostics.length) {
    return undefined;
  }

  const editorContent = document.querySelector('.cm-content') as HTMLElement | null;

  if (!editorContent) {
    return undefined;
  }

  const overlayRoot = document.createElement('div');
  overlayRoot.dataset.ruleTraceOverlay = 'true';
  overlayRoot.style.position = 'fixed';
  overlayRoot.style.inset = '0';
  overlayRoot.style.pointerEvents = 'none';
  overlayRoot.style.zIndex = '9998';
  document.body.appendChild(overlayRoot);

  const peekCard = document.createElement('div');
  peekCard.dataset.ruleTracePeek = 'true';
  peekCard.style.position = 'fixed';
  peekCard.style.display = 'none';
  peekCard.style.maxWidth = '360px';
  peekCard.style.padding = '14px 16px';
  peekCard.style.borderRadius = '12px';
  peekCard.style.background = '#111827';
  peekCard.style.border = '1px solid rgba(99, 102, 241, 0.35)';
  peekCard.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.32)';
  peekCard.style.color = '#f8fafc';
  peekCard.style.font = '12px/1.5 Inter, system-ui, sans-serif';
  peekCard.style.zIndex = '9999';
  peekCard.style.pointerEvents = 'none';
  document.body.appendChild(peekCard);

  const showPeek = (rect: DOMRect, diagnostic: (typeof diagnostics)[number]) => {
    peekCard.innerHTML =
      `<div style="font-weight:700; color:#a5b4fc; margin-bottom:6px">${escapeHtml(diagnostic.peek.title)}</div>` +
      `<div style="margin-bottom:8px">${escapeHtml(diagnostic.message)}</div>` +
      `<div style="margin-bottom:8px; color:#cbd5e1">${escapeHtml(diagnostic.peek.explanation)}</div>` +
      `<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; margin-bottom:6px">${escapeHtml(diagnostic.peek.source)}</div>` +
      `<pre style="margin:0; white-space:pre-wrap; overflow:hidden; border-radius:8px; background:#020617; color:#e2e8f0; padding:12px; font:11px/1.45 'Roboto Mono', 'SFMono-Regular', monospace">${escapeHtml(diagnostic.peek.snippet)}</pre>`;
    peekCard.style.left = `${rect.left}px`;
    peekCard.style.top = `${rect.bottom + 10}px`;
    peekCard.style.display = 'block';
  };

  const hidePeek = () => {
    peekCard.style.display = 'none';
  };

  const render = () => {
    overlayRoot.innerHTML = '';
    hidePeek();

    for (const diagnostic of diagnostics) {
      const range = createRangeFromOffsets(editorContent, diagnostic.from, diagnostic.to);

      if (!range) {
        continue;
      }

      for (const rect of Array.from(range.getClientRects())) {
        const underline = document.createElement('div');
        underline.style.position = 'fixed';
        underline.style.left = `${rect.left}px`;
        underline.style.top = `${rect.bottom - 2}px`;
        underline.style.width = `${rect.width}px`;
        underline.style.height = '4px';
        underline.style.background =
          'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'6\' height=\'3\'%3E%3Cpath d=\'M0 2c.7 0 1.3-.7 2-1.3C2.7.1 3.3 0 4 0c.7 0 1.3.1 2 .7\' fill=\'none\' stroke=\'%23ef4444\' stroke-width=\'1.5\'/%3E%3C/svg%3E") repeat-x bottom';
        underline.style.pointerEvents = 'none';
        overlayRoot.appendChild(underline);

        const hoverTarget = document.createElement('button');
        hoverTarget.type = 'button';
        hoverTarget.style.position = 'fixed';
        hoverTarget.style.left = `${rect.left}px`;
        hoverTarget.style.top = `${rect.top}px`;
        hoverTarget.style.width = `${rect.width}px`;
        hoverTarget.style.height = `${rect.height}px`;
        hoverTarget.style.cursor = 'help';
        hoverTarget.style.pointerEvents = 'auto';
        hoverTarget.style.background = 'transparent';
        hoverTarget.style.border = '0';
        hoverTarget.style.padding = '0';
        hoverTarget.style.margin = '0';
        hoverTarget.style.outline = 'none';
        hoverTarget.dataset.ruleTraceHoverTarget = 'true';

        hoverTarget.onmouseenter = () => showPeek(rect, diagnostic);
        hoverTarget.onmouseleave = hidePeek;
        hoverTarget.onfocus = () => showPeek(rect, diagnostic);
        hoverTarget.onblur = hidePeek;

        overlayRoot.appendChild(hoverTarget);
      }
    }
  };

  const observer = new MutationObserver(render);
  observer.observe(editorContent, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  const rerender = () => render();
  window.addEventListener('resize', rerender);
  document.addEventListener('scroll', rerender, true);

  render();

  return () => {
    observer.disconnect();
    window.removeEventListener('resize', rerender);
    document.removeEventListener('scroll', rerender, true);
    clearRuleOverlay();
  };
}

function clearRuleOverlay() {
  document.querySelectorAll('[data-rule-trace-overlay], [data-rule-trace-peek]').forEach((element) => {
    element.remove();
  });
}

function createRangeFromOffsets(root: HTMLElement, from: number, to: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;
  let textNode: Node | null;

  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent ?? '';
    const nextCursor = cursor + text.length;

    if (!startNode && from >= cursor && from <= nextCursor) {
      startNode = textNode;
      startOffset = Math.max(0, from - cursor);
    }

    if (!endNode && to >= cursor && to <= nextCursor) {
      endNode = textNode;
      endOffset = Math.max(0, to - cursor);
      break;
    }

    cursor = nextCursor;
  }

  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
