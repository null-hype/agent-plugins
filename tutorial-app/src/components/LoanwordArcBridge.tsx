import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import tutorialStore from 'tutorialkit:store';
import {
  parseLoanwordRuntime,
  resolveLoanwordArcConfig,
  validateLoanwordLesson,
  valueToText,
} from '../lib/loanwordArcProtocol';
import type { LoanwordDiagnostic, LoanwordLessonState } from '../lib/loanwordArcProtocol';
import './LoanwordArcBridge.css';

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

const DEFAULT_LESSON_ID = 'fingerspitzengefuhl';
const DEFAULT_TRANSLATION_FILE = '/translation.en';
const DEFAULT_RUNTIME_FILE = '/loanword-runtime.json';
const DEFAULT_STORY_FILE = '/warm-log-story.json';
const DEFAULT_SCENARIO = 'fingerspitzengefuhl-preservation';

interface Props {
  lessonId?: string;
  runtimeFile?: string;
  scenario?: string;
  storyFile?: string;
  translationFile?: string;
  vocabularyFile?: string;
}

export default function LoanwordArcBridge({
  lessonId = DEFAULT_LESSON_ID,
  runtimeFile = DEFAULT_RUNTIME_FILE,
  scenario = DEFAULT_SCENARIO,
  storyFile = DEFAULT_STORY_FILE,
  translationFile = DEFAULT_TRANSLATION_FILE,
  vocabularyFile,
}: Props) {
  const documents = useStore(tutorialStore.documents) as DocumentRecord;
  const currentDocument = useStore(tutorialStore.currentDocument) as
    | {
        filePath: string;
        loading: boolean;
        value: string | Uint8Array;
      }
    | undefined;
  const lesson = tutorialStore.lesson as LessonRecord | undefined;
  const resolvedConfig = useMemo(() => {
    const customConfig = resolveLoanwordArcConfig(lesson?.data?.custom);

    return {
      lessonId: customConfig?.lessonId ?? lessonId,
      runtimeFile: customConfig?.runtimeFile ?? runtimeFile,
      scenario: customConfig?.scenario ?? scenario,
      storyFile: customConfig?.storyFile ?? storyFile,
      translationFile: customConfig?.translationFile ?? translationFile,
      vocabularyFile: customConfig?.vocabularyFile ?? vocabularyFile,
    };
  }, [lesson?.data?.custom, lessonId, runtimeFile, scenario, storyFile, translationFile, vocabularyFile]);
  const translationText = valueToText(documents[resolvedConfig.translationFile]?.value);
  const vocabularyText = resolvedConfig.vocabularyFile
    ? valueToText(documents[resolvedConfig.vocabularyFile]?.value)
    : '';
  const runtimeText = valueToText(documents[resolvedConfig.runtimeFile]?.value);
  const runtime = useMemo(() => parseLoanwordRuntime(runtimeText), [runtimeText]);
  const revisionRef = useRef(Date.now());
  const [protocolState, setProtocolState] = useState<LoanwordLessonState | null>(null);

  useEffect(() => {
    let cancelled = false;
    revisionRef.current += 1;
    const revision = revisionRef.current;

    validateLoanwordLesson({
      lessonId: resolvedConfig.lessonId,
      runtime,
      translationFile: resolvedConfig.translationFile,
      translationText,
      vocabularyFile: resolvedConfig.vocabularyFile,
      vocabularyText,
    }).then((result) => {
      if (cancelled || revision !== revisionRef.current) {
        return;
      }

      setProtocolState({
        ...result,
        revision,
        scenario: resolvedConfig.scenario || runtime.scenario,
        storyFile: resolvedConfig.storyFile,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    resolvedConfig.lessonId,
    resolvedConfig.scenario,
    resolvedConfig.storyFile,
    resolvedConfig.translationFile,
    resolvedConfig.vocabularyFile,
    runtime,
    translationText,
    vocabularyText,
  ]);

  useEffect(() => {
    if (!protocolState) {
      return undefined;
    }

    const message = {
      payload: protocolState,
      source: 'tk-loanword-arc-bridge',
      type: 'lesson-state',
    };
    const send = (frame: HTMLIFrameElement) => frame.contentWindow?.postMessage(message, '*');
    const onReady = (event: MessageEvent) => {
      if (event.data?.type !== 'lesson-preview-ready' || event.data?.source !== 'tk-warm-log-preview') {
        return;
      }
      const frame = getPreviewFrames().find((frame) => frame.contentWindow === event.source);
      if (frame) send(frame);
    };
    window.addEventListener('message', onReady);
    // Existing frames receive edits immediately; newly started or reloaded
    // previews request the latest state, regardless of WebContainer boot time.
    getPreviewFrames().forEach(send);

    return () => {
      window.removeEventListener('message', onReady);
    };
  }, [protocolState]);

  useEffect(() => {
    if (!protocolState || !currentDocument?.filePath) {
      clearLoanwordOverlay();
      return undefined;
    }

    const diagnostics = protocolState.diagnostics.filter(
      (diagnostic) => diagnostic.filePath === currentDocument.filePath,
    );

    if (!diagnostics.length) {
      clearLoanwordOverlay();
      return undefined;
    }

    const documentText = valueToText(currentDocument.value);
    return installLoanwordOverlay(diagnostics, documentText);
  }, [currentDocument?.filePath, currentDocument?.value, protocolState]);

  const sourcePreserved = translationText.trim() === runtime.canonicalTranslation;
  const state = protocolState?.previewState;
  const feedback = state === 'completed'
    ? 'Accepted by this lesson’s rules. The preview can now show the completion example.'
    : state === 'loanword-pending-admission'
      ? `The source form is preserved. Add its entry to ${resolvedConfig.vocabularyFile?.slice(1)} to pass the second check.`
      : state === 'paraphrase-loss'
        ? `This lesson requires the source form “${runtime.canonicalTranslation}”. Edit translation.en to preserve it.`
        : 'Enter a proposal in translation.en to check it.';

  return (
    <section className="gap-check" aria-label="Lesson validation">
      <div className="gap-check-heading">
        <span className="gap-check-eyebrow">Proposal → rule → result</span>
        <strong className="gap-check-badge" data-state={state}>
          {state === 'completed' ? 'Accepted' : state && state !== 'idle' ? 'Blocked' : 'Awaiting input'}
        </strong>
      </div>
      <p className="gap-check-proposal"><span>Your proposal</span> <code>{translationText.trim() || '…'}</code></p>
      <ol className="gap-check-gates">
        <li>
          <span aria-hidden="true">{sourcePreserved ? '✓' : '○'}</span>
          <span>Preserve the source form <code>{runtime.canonicalTranslation}</code></span>
        </li>
        {runtime.requiresVocabularyAdmission && <li>
          <span aria-hidden="true">{protocolState?.solved ? '✓' : '○'}</span>
          <span>Admit the word to your vocabulary</span>
        </li>}
      </ol>
      <p role="status" aria-live="polite" className="gap-check-feedback">{feedback}</p>
      <div className="gap-check-actions">
        <button type="button" onClick={() => tutorialStore.setSelectedFile(resolvedConfig.translationFile)}>Edit proposal</button>
        {runtime.requiresVocabularyAdmission && <button type="button" onClick={() => tutorialStore.setSelectedFile(resolvedConfig.vocabularyFile)}>Open vocabulary</button>}
      </div>
      <details className="gap-check-details">
        <summary>Inspect the rule and runtime</summary>
        <p><code>LoanwordRules.pkl</code> describes the rule. The browser reads <code>loanword-runtime.json</code> and checks your proposal against it.</p>
        <div className="gap-check-actions">
          <button type="button" onClick={() => tutorialStore.setSelectedFile('/LoanwordRules.pkl')}>View Pkl rule</button>
          <button type="button" onClick={() => tutorialStore.setSelectedFile(resolvedConfig.runtimeFile)}>View runtime JSON</button>
        </div>
        <p>This prototype compares the source form and checks the vocabulary entry’s text. It does not run a Pkl evaluator or judge translation quality. Editing the Pkl rule does not regenerate the runtime JSON.</p>
        <p>The Warm Log is a scripted illustration of the result, not a live agent execution trace.</p>
      </details>
    </section>
  );
}

function getPreviewFrames() {
  return Array.from(document.querySelectorAll('#previews-container iframe, .previews-container iframe')) as HTMLIFrameElement[];
}

function installLoanwordOverlay(diagnostics: LoanwordDiagnostic[], documentText: string) {
  clearLoanwordOverlay();

  const editorContent = document.querySelector('.cm-content') as HTMLElement | null;

  if (!editorContent) {
    return undefined;
  }

  const overlayRoot = document.createElement('div');
  overlayRoot.dataset.loanwordArcOverlay = 'true';
  overlayRoot.style.position = 'fixed';
  overlayRoot.style.inset = '0';
  overlayRoot.style.pointerEvents = 'none';
  overlayRoot.style.zIndex = '9998';
  document.body.appendChild(overlayRoot);

  const peekCard = document.createElement('div');
  peekCard.dataset.loanwordArcPeek = 'true';
  peekCard.style.position = 'fixed';
  peekCard.style.display = 'none';
  peekCard.style.maxWidth = '380px';
  peekCard.style.padding = '14px 16px';
  peekCard.style.borderRadius = '12px';
  peekCard.style.background = '#1a1915';
  peekCard.style.border = '1px solid rgba(225, 159, 64, 0.35)';
  peekCard.style.boxShadow = '0 18px 48px rgba(0, 0, 0, 0.32)';
  peekCard.style.color = '#faf7ef';
  peekCard.style.font = '12px/1.5 Inter, system-ui, sans-serif';
  peekCard.style.zIndex = '9999';
  peekCard.style.pointerEvents = 'none';
  document.body.appendChild(peekCard);

  const showPeek = (rect: DOMRect, diagnostic: LoanwordDiagnostic) => {
    const peek = diagnostic.data?.peek;

    if (!peek) {
      peekCard.innerHTML = `<div>${escapeHtml(diagnostic.message)}</div>`;
    } else {
      peekCard.innerHTML =
        `<div style="font-weight:700; color:#f6c66c; margin-bottom:6px">${escapeHtml(peek.title)}</div>` +
        `<div style="margin-bottom:8px">${escapeHtml(diagnostic.message)}</div>` +
        `<div style="margin-bottom:8px; color:#e8dcc2">${escapeHtml(peek.explanation)}</div>` +
        `<div style="font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:#b7a67d; margin-bottom:6px">${escapeHtml(peek.source)}</div>` +
        `<pre style="margin:0; white-space:pre-wrap; overflow:hidden; border-radius:8px; background:#0f0d09; color:#f5f1e8; padding:12px; font:11px/1.45 'Roboto Mono', 'SFMono-Regular', monospace">${escapeHtml(peek.snippet)}</pre>`;
    }

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
      const offsetRange = rangeToOffsets(documentText, diagnostic.range);
      const range = createRangeFromOffsets(editorContent, offsetRange.from, offsetRange.to);

      if (!range) {
        continue;
      }

      for (const rect of Array.from(range.getClientRects())) {
        const underline = document.createElement('div');
        underline.style.position = 'fixed';
        underline.style.left = `${rect.left}px`;
        underline.style.top = `${rect.bottom - 2}px`;
        underline.style.width = `${Math.max(rect.width, 8)}px`;
        underline.style.height = '4px';
        underline.style.background =
          'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'6\' height=\'3\'%3E%3Cpath d=\'M0 2c.7 0 1.3-.7 2-1.3C2.7.1 3.3 0 4 0c.7 0 1.3.1 2 .7\' fill=\'none\' stroke=\'%23e19f40\' stroke-width=\'1.5\'/%3E%3C/svg%3E") repeat-x bottom';
        underline.style.pointerEvents = 'none';
        overlayRoot.appendChild(underline);

        const hoverTarget = document.createElement('button');
        hoverTarget.type = 'button';
        hoverTarget.style.position = 'fixed';
        hoverTarget.style.left = `${rect.left}px`;
        hoverTarget.style.top = `${rect.top}px`;
        hoverTarget.style.width = `${Math.max(rect.width, 8)}px`;
        hoverTarget.style.height = `${Math.max(rect.height, 18)}px`;
        hoverTarget.style.cursor = 'help';
        hoverTarget.style.pointerEvents = 'auto';
        hoverTarget.style.background = 'transparent';
        hoverTarget.style.border = '0';
        hoverTarget.style.padding = '0';
        hoverTarget.style.margin = '0';
        hoverTarget.style.outline = 'none';
        hoverTarget.dataset.loanwordArcHoverTarget = 'true';

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
    clearLoanwordOverlay();
  };
}

function clearLoanwordOverlay() {
  document
    .querySelectorAll('[data-loanword-arc-overlay], [data-loanword-arc-peek]')
    .forEach((element) => {
      element.remove();
    });
}

function rangeToOffsets(
  text: string,
  range: LoanwordDiagnostic['range'],
): { from: number; to: number } {
  return {
    from: offsetFromPosition(text, range.start.line, range.start.character),
    to: Math.max(
      offsetFromPosition(text, range.start.line, range.start.character) + 1,
      offsetFromPosition(text, range.end.line, range.end.character),
    ),
  };
}

function offsetFromPosition(text: string, line: number, character: number) {
  const lines = text.split('\n');
  let offset = 0;

  for (let index = 0; index < line; index += 1) {
    offset += (lines[index] ?? '').length + 1;
  }

  return Math.max(0, Math.min(offset + character, text.length));
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
