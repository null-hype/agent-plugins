import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef } from 'react';
import tutorialStore from 'tutorialkit:store';
import {
  buildCommandProtocolState,
  parseCommandProtocolRuntime,
  valueToText,
} from '../lib/commandProtocol';

type DocumentRecord = Record<
  string,
  | {
      filePath: string;
      loading: boolean;
      value: string | Uint8Array;
    }
  | undefined
>;

interface Props {
  commandFile?: string;
  runtimeFile?: string;
}

const DEFAULT_COMMAND_FILE = '/exercise.de';
const DEFAULT_RUNTIME_FILE = '/command-protocol.json';

export default function CommandProtocolBridge({
  commandFile = DEFAULT_COMMAND_FILE,
  runtimeFile = DEFAULT_RUNTIME_FILE,
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

  const commandText = valueToText(documents[commandFile]?.value);
  const runtimeText = valueToText(documents[runtimeFile]?.value);
  const protocolState = useMemo(() => {
    revisionRef.current += 1;

    return buildCommandProtocolState({
      revision: revisionRef.current,
      runtime: parseCommandProtocolRuntime(runtimeText),
      text: commandText,
    });
  }, [commandText, runtimeText]);

  useEffect(() => {
    const message = {
      payload: protocolState,
      source: 'tk-command-bridge',
      type: 'command-state',
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
    const isActiveFile = currentDocument?.filePath === commandFile;

    if (!isActiveFile) {
      clearProtocolOverlay();
      return undefined;
    }

    return installProtocolOverlay(protocolState.diagnostics);
  }, [commandFile, currentDocument?.filePath, protocolState.diagnostics, protocolState.revision]);

  return null;
}

function getPreviewFrames() {
  return Array.from(document.querySelectorAll('#previews-container iframe, .previews-container iframe')) as HTMLIFrameElement[];
}

function installProtocolOverlay(
  diagnostics: ReturnType<typeof buildCommandProtocolState>['diagnostics'],
) {
  clearProtocolOverlay();

  if (!diagnostics.length) {
    return undefined;
  }

  const editorContent = document.querySelector('.cm-content') as HTMLElement | null;

  if (!editorContent) {
    return undefined;
  }

  const overlayRoot = document.createElement('div');
  overlayRoot.dataset.commandProtocolOverlay = 'true';
  overlayRoot.style.position = 'fixed';
  overlayRoot.style.inset = '0';
  overlayRoot.style.pointerEvents = 'none';
  overlayRoot.style.zIndex = '9998';
  document.body.appendChild(overlayRoot);

  const tooltip = document.createElement('div');
  tooltip.dataset.commandProtocolTooltip = 'true';
  tooltip.style.position = 'fixed';
  tooltip.style.display = 'none';
  tooltip.style.maxWidth = '280px';
  tooltip.style.padding = '12px 14px';
  tooltip.style.borderRadius = '10px';
  tooltip.style.background = '#1f1713';
  tooltip.style.border = '1px solid rgba(238, 102, 85, 0.35)';
  tooltip.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.32)';
  tooltip.style.color = '#fff8f3';
  tooltip.style.font = '12px/1.5 Inter, system-ui, sans-serif';
  tooltip.style.zIndex = '9999';
  tooltip.style.pointerEvents = 'none';
  document.body.appendChild(tooltip);

  const render = () => {
    overlayRoot.innerHTML = '';
    tooltip.style.display = 'none';

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

        const hoverTarget = document.createElement('div');
        hoverTarget.style.position = 'fixed';
        hoverTarget.style.left = `${rect.left}px`;
        hoverTarget.style.top = `${rect.top}px`;
        hoverTarget.style.width = `${rect.width}px`;
        hoverTarget.style.height = `${rect.height}px`;
        hoverTarget.style.cursor = 'help';
        hoverTarget.style.pointerEvents = 'auto';
        hoverTarget.style.background = 'transparent';

        hoverTarget.onmouseenter = () => {
          tooltip.innerHTML =
            '<div style="font-weight:700; color:#ff9f8f; margin-bottom:4px">Command Protocol</div>' +
            `<div>${escapeHtml(diagnostic.message)}</div>`;
          tooltip.style.left = `${rect.left}px`;
          tooltip.style.top = `${rect.bottom + 10}px`;
          tooltip.style.display = 'block';
        };

        hoverTarget.onmouseleave = () => {
          tooltip.style.display = 'none';
        };

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
    clearProtocolOverlay();
  };
}

function clearProtocolOverlay() {
  document.querySelectorAll('[data-command-protocol-overlay], [data-command-protocol-tooltip]').forEach((element) => {
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
