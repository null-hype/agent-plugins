import homepage from './homepage.recording.json';
import signalHierarchy from './signal-hierarchy.recording.json';
import yoars5484 from './yoars-5484.recording.json';
import type { ReplayRecording } from '../lib/acpReplayContract';

/**
 * Threads published on tidelands.dev, by the id `?thread=` takes. A link
 * names one of these rather than carrying it, so a thread can still be
 * corrected after the link has gone out in a résumé.
 */
export const PUBLISHED_THREADS: Record<string, ReplayRecording> = {
  homepage: homepage as ReplayRecording,
  'yoars-5484': yoars5484 as ReplayRecording,
  'signal-hierarchy': signalHierarchy as ReplayRecording,
};

export const DEFAULT_THREAD = 'homepage';
