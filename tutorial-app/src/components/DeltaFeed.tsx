import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { validateReplayRecording, type ReplayFrame, type ReplayRecording } from '../lib/acpReplayContract';
import './DeltaFeed.css';

/**
 * A Delta thread as a page: each step is a section in normal document flow,
 * so the page is the only thing that scrolls. Frames marked `_meta.beside`
 * share a step with the frame before them (side by side on wide screens).
 */

type Update = { sessionUpdate: string; title?: string; content?: { text?: string }; _meta?: { beside?: boolean } };
type Card = { id: string; frames: ReplayFrame[]; speaker: string; you: boolean; text: string; titles: string[]; beside?: boolean };

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
    cards.push({ id: frame.frameId, frames: [frame], speaker: frame.speaker ?? '', you: frame.actor === 'client', text: update.content?.text ?? '', titles: [], beside: update._meta?.beside });
  }
  return cards;
}

// -- a small Markdown subset: paragraphs, lists, quotes, tables, **bold**, `code`, [links](url)

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    if (m[2]) out.push(<a key={m.index} className="df-shot" href={m[2]} target="_blank" rel="noreferrer"><img src={m[2]} alt={m[1]} loading="lazy" /></a>);
    else if (m[3]) out.push(<strong key={m.index}>{inline(m[3])}</strong>);
    else if (m[4]) out.push(<code key={m.index}>{m[4]}</code>);
    else out.push(/^(https?:|\/)/.test(m[6]) ? <a key={m.index} href={m[6]} target="_blank" rel="noreferrer">{inline(m[5])}</a> : <span key={m.index}>{inline(m[5])}</span>);
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
    return <table><thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead><tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table>;
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

function Message({ card }: { card: Card }) {
  return (
    <div className={`df-msg${card.you ? ' df-you' : ''}`}>
      <p className="df-speaker">{card.speaker}</p>
      {card.titles.length ? <ol className="df-tools">{card.titles.map((t, i) => <li key={i}>{t}</li>)}</ol> : <Markdown text={card.text} />}
    </div>
  );
}

type Props = {
  recording: ReplayRecording;
  /** Scroll to this frame on load; defaults to `?frame=` (or `end`). */
  initialFrameId?: string;
  /** A last step after the frames, e.g. the contact form. Its id is `end`. */
  end?: ReactNode;
};

export default function DeltaFeed({ recording: initial, initialFrameId, end }: Props) {
  const [recording, setRecording] = useState(initial);
  const steps = useMemo(() => {
    const out: Card[][] = [];
    for (const card of toCards(recording.frames)) card.beside && out.length ? out[out.length - 1].push(card) : out.push([card]);
    return out;
  }, [recording]);
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

  // Deep links: ?frame=<id> (and #<id>) open at that step.
  useEffect(() => {
    const wanted = initialFrameId ?? new URLSearchParams(window.location.search).get('frame');
    if (wanted) document.getElementById(wanted)?.scrollIntoView({ block: 'start' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (invalid) return <p role="alert">This feed could not be loaded: {invalid.reason}</p>;

  const ids = [...steps.map((s) => s[0].id), ...(end ? ['end'] : [])];
  const next = (i: number) => ids[i + 1] && <a className="df-next" href={`#${ids[i + 1]}`}>Next ↓</a>;

  return (
    <div className="df" role="region" aria-label="Delta thread">
      {steps.map((step, i) => (
        <section key={step[0].id} id={step[0].id} className={`df-step${step.length > 1 ? ' df-pair' : ''}`} aria-label={`Step ${i + 1} of ${ids.length}`}>
          <div className="df-body">{step.map((card) => <Message key={card.id} card={card} />)}</div>
          {next(i)}
        </section>
      ))}
      {end && <section id="end" className="df-step df-end" aria-label={`Step ${ids.length} of ${ids.length}`}><div className="df-body">{end}</div></section>}
    </div>
  );
}
