import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { AcpReplayController } from '../lib/acpReplayController';
import { validateReplayRecording, type ReplayFrame, type ReplayRecording } from '../lib/acpReplayContract';
import './DeltaFeed.css';

/**
 * A Delta thread as a feed: swipe up/down to step through it, right to step
 * into a frame, left to back out. Native scroll does the vertical motion;
 * only the horizontal gesture is ours.
 */

type Update = { sessionUpdate: string; title?: string; content?: { text?: string } };
type Card = { id: string; frames: ReplayFrame[]; speaker: string; you: boolean; text: string; titles: string[] };

const updateOf = (frame: ReplayFrame) => (frame.envelope.params as { update: Update }).update;

function toCards(frames: readonly ReplayFrame[]): Card[] {
  const cards: Card[] = [];
  for (const frame of frames) {
    const update = updateOf(frame);
    const last = cards[cards.length - 1];
    if (update.sessionUpdate === 'tool_call') {
      if (last?.titles.length && !last.text) { last.frames.push(frame); last.titles.push(update.title ?? ''); last.id = frame.frameId; continue; }
      cards.push({ id: frame.frameId, frames: [frame], speaker: frame.speaker ?? 'Agent', you: false, text: '', titles: [update.title ?? ''] });
      continue;
    }
    cards.push({ id: frame.frameId, frames: [frame], speaker: frame.speaker ?? '', you: frame.actor === 'client', text: update.content?.text ?? '', titles: [] });
  }
  return cards;
}

// -- a small Markdown subset: paragraphs, lists, quotes, tables, **bold**, `code`, [links](url)

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    if (m[1]) out.push(<strong key={m.index}>{inline(m[1])}</strong>);
    else if (m[2]) out.push(<code key={m.index}>{m[2]}</code>);
    else out.push(/^https?:/.test(m[4]) ? <a key={m.index} href={m[4]} target="_blank" rel="noreferrer">{inline(m[3])}</a> : <span key={m.index}>{inline(m[3])}</span>);
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function blocks(text: string): string[] {
  return text.trim().split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}

function Block({ source }: { source: string }) {
  const lines = source.split('\n');
  if (lines.every((l) => l.trim().startsWith('|'))) {
    const rows = lines.filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const [head, ...body] = rows;
    return <div className="df-table"><table><thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead><tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>;
  }
  if (lines.every((l) => /^(\s*[-*]|\s*\d+\.)\s/.test(l))) {
    const ordered = /^\s*\d+\./.test(lines[0]);
    const items = lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>);
    return ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  if (lines.every((l) => l.startsWith('>'))) return <blockquote>{lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l.replace(/^>\s?/, ''))}</Fragment>)}</blockquote>;
  if (/^#{1,6}\s/.test(source)) return <h4>{inline(source.replace(/^#+\s*/, ''))}</h4>;
  return <p>{lines.map((l, i) => <Fragment key={i}>{i > 0 && ' '}{inline(l)}</Fragment>)}</p>;
}

const Markdown = ({ text }: { text: string }) => <>{blocks(text).map((b, i) => <Block key={i} source={b} />)}</>;

const hasMore = (card: Card) => card.titles.length > 0 || blocks(card.text).length > 1;

export default function DeltaFeed({ recording: initial, initialFrameId }: { recording: ReplayRecording; initialFrameId?: string }) {
  const [recording, setRecording] = useState(initial);
  const controller = useMemo(() => new AcpReplayController(recording), [recording]);
  const cards = useMemo(() => toCards(recording.frames), [recording]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const invalid = validateReplayRecording(recording);

  // Live preview: a driver (Storybook, a dev relay on `delta thread watch`) can append frames.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; frame?: ReplayFrame } | null;
      if (event.origin !== window.location.origin || data?.type !== 'trace.append' || !data.frame) return;
      setRecording((r) => ({ ...r, frames: [...r.frames, { ...data.frame!, order: r.frames.length }] }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Open at ?frame= (or the given frame), then keep the URL on the visible frame.
  useEffect(() => {
    const wanted = initialFrameId ?? new URLSearchParams(window.location.search).get('frame');
    const index = wanted ? cards.findIndex((c) => c.frames.some((f) => f.frameId === wanted)) : -1;
    if (index > 0) scroller.current?.children[index]?.scrollIntoView({ block: 'start' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.index);
        setActive(index);
        setOpen(null);
        controller.seek(cards[index].id);
        if (index > 0 || new URLSearchParams(window.location.search).has('frame')) {
          const url = new URL(window.location.href);
          url.searchParams.set('frame', cards[index].id);
          window.history.replaceState(window.history.state, '', url);
        }
      }
    }, { root, threshold: 0.6 });
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [cards, controller]);

  const go = (index: number) => scroller.current?.children[Math.max(0, Math.min(cards.length - 1, index))]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const stepIn = () => { if (hasMore(cards[active])) setOpen(active); };
  const backOut = () => setOpen(null);

  const onTouchStart = (e: TouchEvent) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx > 0 ? stepIn : backOut)();
  };

  if (invalid) return <p role="alert">This feed could not be loaded: {invalid.reason}</p>;

  return (
    <section
      className="df"
      aria-label="Delta thread"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); go(active + 1); }
        else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); go(active - 1); }
        else if (e.key === 'ArrowRight' || e.key === 'Enter') stepIn();
        else if (e.key === 'ArrowLeft' || e.key === 'Escape') backOut();
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="df-scroller" ref={scroller}>
        {cards.map((card, index) => {
          const first = blocks(card.text)[0];
          const isOpen = open === index;
          return (
            <article key={card.id} data-index={index} className={`df-frame${card.you ? ' df-you' : ''}${isOpen ? ' df-open' : ''}`} aria-label={`${index + 1} of ${cards.length}`}>
              <p className="df-speaker">{card.speaker}</p>
              <div className="df-face" aria-hidden={isOpen}>
                {card.titles.length ? <p className="df-tools">{card.titles.length === 1 ? card.titles[0] : `${card.titles.length} steps`}</p> : <Markdown text={first ?? ''} />}
                {hasMore(card) && <button type="button" className="df-in" onClick={() => setOpen(index)}>Step in →</button>}
              </div>
              {isOpen && (
                <div className="df-detail">
                  <button type="button" className="df-out" onClick={backOut}>← Back</button>
                  {card.titles.length ? <ol className="df-steps">{card.titles.map((t, i) => <li key={i}>{t}</li>)}</ol> : <Markdown text={card.text} />}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <nav className="df-nav" aria-label="Step through the thread">
        <button type="button" onClick={() => go(active - 1)} disabled={active === 0} aria-label="Previous">↑</button>
        <span>{active + 1} / {cards.length}</span>
        <button type="button" onClick={() => go(active + 1)} disabled={active === cards.length - 1} aria-label="Next">↓</button>
      </nav>
    </section>
  );
}
