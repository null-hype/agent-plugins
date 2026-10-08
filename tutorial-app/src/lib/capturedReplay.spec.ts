import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CAPTURE_PIN, capturedPresentation, loadCapturedReplay } from '../../tests/rails-probes/captures';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function isolatedPin() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cit337-test-'));
  directories.push(dir);
  const pin = path.join(dir, 'bundle.json');
  copyFileSync(CAPTURE_PIN, pin);
  copyFileSync(path.join(path.dirname(CAPTURE_PIN), 'capture-pins.json'), path.join(dir, 'capture-pins.json'));
  copyFileSync(path.join(path.dirname(CAPTURE_PIN), 'bundle.tar.gz'), path.join(dir, 'bundle.tar.gz'));
  return { dir, pin };
}

describe('retained installed-scenario replay', () => {
  it('preserves historical claims, reproduced answers and their assessment across both revisions', () => {
    const capture = loadCapturedReplay();
    expect(capture.investigation.records.map((r: any) => r.state.id)).toEqual(['S1-pinned', 'S2-pinned']);
    for (const key of ['S1', 'S2'] as const) {
      const record = capture.investigation.records.find((r: any) => r.state.id === key + '-pinned');
      expect(record.forecast).toBeNull();
      expect(record.declarations.some((d: any) => d.evidence.origin === 'historical')).toBe(true);
      expect(record.declarations.some((d: any) => d.observedFrom?.origin === 'reproduced')).toBe(true);
      expect(record.observations.some((e: any) => e.availability === 'retained' && e.origin === 'reproduced')).toBe(true);
      expect(capture.files.has(key + '/runs/deleted-trace/inputs/canary-reads.txt')).toBe(false);
      const presentation = capturedPresentation(capture, key);
      expect(presentation.get('probes/deleted-trace/result.txt')).toContain('exit code: ' + record.answer.exitCode);
      expect(JSON.parse(presentation.get('probes/deleted-trace/answer.json')!)).toEqual(record.answer);
      expect(record.observations.some((e: any) => e.origin === 'historical' && e.availability === 'missing' && e.reason.includes("reviewer's own"))).toBe(true);
      expect(capture.pin.captures.find((c: any) => c.state === key).snapshotId).toMatch(/^[0-9a-f]{64}$/);

    }
  }, 15_000);

  it('rejects changed archive bytes before rendering', () => {
    const { dir, pin } = isolatedPin();
    const file = path.join(dir, 'bundle.tar.gz');
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 1;
    writeFileSync(file, bytes);
    expect(() => loadCapturedReplay(pin)).toThrow('Pinned replay archive changed');
  });

  it('refuses missing retained input instead of falling back to authored results', () => {
    const { dir, pin } = isolatedPin();
    rmSync(path.join(dir, 'bundle.tar.gz'));
    expect(() => loadCapturedReplay(pin)).toThrow(/ENOENT/);
  });

  it('rejects an incomplete restored inventory even when the archive hash agrees', () => {
    const { pin } = isolatedPin();
    const data = JSON.parse(readFileSync(pin, 'utf8'));
    data.files.pop();
    writeFileSync(pin, JSON.stringify(data));
    expect(() => loadCapturedReplay(pin)).toThrow('Restored replay inventory changed');
  });
  it('rejects a cache detached from its canonical snapshot selection', () => {
    const { pin } = isolatedPin();
    const data = JSON.parse(readFileSync(pin, 'utf8'));
    data.captures[0].snapshotId = '0'.repeat(64);
    writeFileSync(pin, JSON.stringify(data));
    expect(() => loadCapturedReplay(pin)).toThrow('Canonical capture pins changed');
  });

});
