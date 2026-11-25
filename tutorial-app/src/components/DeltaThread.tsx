import { useEffect, useState, type ReactNode } from 'react';
import DeltaFeed from './DeltaFeed';
import { DEFAULT_THREAD, PUBLISHED_THREADS } from '../feed/published';
import { decodeThread } from '../lib/threadLink';
import type { ReplayRecording } from '../lib/acpReplayContract';

type Props = {
  /** A published thread id (`yoars-5484`) or an encoded link (`v1-…`). Unset: read `?thread=` / `#t=` from the page URL. */
  thread?: string;
  /** Frame to open at; unset, the feed reads `?frame=`. */
  frame?: string;
  /** Render encoded links. Off on the public site: anyone can mint one. */
  allowLinks?: boolean;
  end?: ReactNode;
};

type Resolved = { key: string; recording: ReplayRecording } | { key: string; reason: string };

export function resolveThread(thread: string | undefined, allowLinks: boolean): Resolved {
  const value = thread || DEFAULT_THREAD;
  if (value.startsWith('v1-')) {
    if (!allowLinks) return { key: value, reason: 'thread links only render in previews' };
    const decoded = decodeThread(value);
    return { key: value, ...decoded };
  }
  const recording = PUBLISHED_THREADS[value];
  return recording ? { key: value, recording } : { key: value, reason: `no published thread called “${value}”` };
}

const fromLocation = () => {
  const hash = new URLSearchParams(window.location.hash.slice(1)).get('t');
  return hash || new URLSearchParams(window.location.search).get('thread') || undefined;
};

/** A Delta feed for a published thread or an encoded thread link. */
export default function DeltaThread({ thread, frame, allowLinks = false, end }: Props) {
  // Server render and first paint use the default thread; the URL is read after hydration.
  const [requested, setRequested] = useState(thread);
  useEffect(() => {
    if (thread !== undefined) { setRequested(thread); return; }
    const sync = () => setRequested(fromLocation());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [thread]);

  let resolved = resolveThread(requested, allowLinks);
  // On the site a bad link still shows the homepage thread; previews say what went wrong.
  if ('reason' in resolved && !allowLinks) resolved = resolveThread(undefined, false);
  if ('reason' in resolved) return <p role="alert">This thread could not be loaded: {resolved.reason}.</p>;
  return <DeltaFeed key={resolved.key} recording={resolved.recording} initialFrameId={frame} threads={PUBLISHED_THREADS} end={end} />;
}
