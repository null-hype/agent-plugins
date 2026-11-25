import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeThread, encodeThread } from './threadLink';
import { resolveThread } from '../components/DeltaThread';

const recording = (slug: string) => JSON.parse(readFileSync(new URL(`../feed/${slug}.recording.json`, import.meta.url), 'utf8'));

it.each(['homepage', 'yoars-5484', 'signal-hierarchy'])('round-trips %s through a URL-safe link', (slug) => {
  const link = encodeThread(recording(slug));
  expect(link).toMatch(/^v1-[A-Za-z0-9_-]+$/);
  expect(decodeThread(link)).toEqual({ recording: recording(slug) });
});

it('rejects links that are not threads', () => {
  expect(decodeThread('v1-AAAA')).toHaveProperty('reason');
  expect(decodeThread('v2-AAAA')).toHaveProperty('reason');
  expect(decodeThread('v1-a+b/c')).toHaveProperty('reason');
  expect(decodeThread(encodeThread({ frames: [{ order: 3 }] } as never))).toHaveProperty('reason');
});

it('renders published ids anywhere, encoded links only where allowed', () => {
  const link = encodeThread(recording('yoars-5484'));
  expect(resolveThread('yoars-5484', false)).toHaveProperty('recording');
  expect(resolveThread(undefined, false)).toMatchObject({ key: 'homepage' });
  expect(resolveThread(link, false)).toHaveProperty('reason');
  expect(resolveThread(link, true)).toHaveProperty('recording');
  expect(resolveThread('nope', true)).toHaveProperty('reason');
});
