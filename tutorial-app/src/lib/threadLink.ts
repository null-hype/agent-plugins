import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { validateReplayRecording, type ReplayRecording } from './acpReplayContract';

/**
 * A projected Delta thread carried in a link, so any thread can be rendered
 * without committing a fixture: `v1-` + base64url(deflate(JSON)).
 *
 * The alphabet is [A-Za-z0-9_-], which survives Storybook's `?args=` and a
 * URL fragment unescaped. Anyone can mint one, so a blob is a preview, not a
 * publication: the public homepage only renders published thread ids.
 */

const PREFIX = 'v1-';
/** Caps the inflated size at roughly 32 MB (deflate tops out near 1032:1). */
export const MAX_LINK_LENGTH = 32_768;

const toBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export function encodeThread(recording: ReplayRecording): string {
  return PREFIX + toBase64Url(deflateSync(strToU8(JSON.stringify(recording)), { level: 9 }));
}

export type DecodedThread = { recording: ReplayRecording } | { reason: string };

export function decodeThread(link: string): DecodedThread {
  if (!link.startsWith(PREFIX)) return { reason: `unknown thread link version (expected ${PREFIX}…)` };
  if (link.length > MAX_LINK_LENGTH) return { reason: `thread link is ${link.length} characters; the limit is ${MAX_LINK_LENGTH}` };
  if (!/^[A-Za-z0-9_-]*$/.test(link.slice(PREFIX.length))) return { reason: 'thread link has characters outside base64url' };
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(inflateSync(fromBase64Url(link.slice(PREFIX.length)))));
  } catch {
    return { reason: 'thread link does not decode' };
  }
  const recording = value as ReplayRecording;
  if (!recording || typeof recording !== 'object' || !Array.isArray(recording.frames)) return { reason: 'thread link holds no frames' };
  try {
    const invalid = validateReplayRecording(recording);
    return invalid ? { reason: invalid.reason } : { recording };
  } catch {
    return { reason: 'thread link holds malformed frames' };
  }
}
