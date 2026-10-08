import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadForecastReplay, FORECAST_PIN } from './captures';
import { generateForecastReplay } from './generate';
import { replayForecast } from '../../../src/cve-2026-66066/questions/forecast/replay';
import { FORECAST_BUNDLE } from './generate';
import { loadCapturedReplay } from '../rails-probes/captures';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'src/cve-2026-66066/questions/forecast/Record.pkl');
const temporary = (run: (dir: string) => void) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cit338-test-'));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const record = JSON.parse(readFileSync(path.join(FORECAST_BUNDLE, 'record.json'), 'utf8'));

describe('the contrasting case through shared records', () => {
  it('validates both cases, preserving observations and missing answers', () => {
    expect(loadCapturedReplay().investigation.records.map((r: any) => r.outcome)).toEqual(['out-of-range', 'out-of-range']);
    expect(record['was-i-vulnerable'].records.map((r: any) => [r.forecast, r.answer, r.outcome])).toEqual([[0.5, null, 'not-collected'], [0.5, null, 'not-collected']]);
    expect(record['file-reaches-matload'].records[0].forecast).toBe(0.4);
    expect(record['attacker-reaches-it'].records[0].forecast).toBe(0.8);
    expect(record['was-i-vulnerable'].records[1].declarations.map((d: any) => d.observed)).toEqual([null, 0.32, -0.18]);
  });
  it('identifies the installed execution without claiming a historical container', () => {
    const replay = loadForecastReplay();
    const selected = replay.pin.captures[0];
    expect(selected.source.artifactId).toBeGreaterThan(0);
    expect(selected.snapshotId).toMatch(/^[a-f0-9]{64}$/);
    expect(selected.image.configDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(selected.delivery.packageVersion).toBe('0.4.0');
    expect(selected.executionSource.dirtyPaths).toEqual([]);
    for (const investigation of Object.values(replay.investigations) as any[]) for (const record of investigation.records) {
      expect(record.state.image.availability).toBe('missing');
      expect(record.state.snapshot.availability).toBe('missing');
    }
  });
  it('rejects an unavailable or tampered pinned export without collecting evidence', () => temporary((dir) => {
    for (const changed of [false, true]) {
      const copy = path.join(dir, String(changed)); cpSync(path.dirname(FORECAST_PIN), copy, { recursive: true });
      const archive = path.join(copy, 'bundle.tar.gz');
      if (changed) writeFileSync(archive, 'tampered'); else unlinkSync(archive);
      expect(() => generateForecastReplay(false, path.join(copy, 'bundle.json'), path.join(dir, 'output'), path.join(dir, 'presentation.json'))).toThrow();
    }
  }));
  it('restores from retained files after the input workspace is gone', () => temporary((dir) => {
    const copy = path.join(dir, 'retained'); cpSync(FORECAST_BUNDLE, copy, { recursive: true });
    const installedBefore = readFileSync(path.join(copy, 'installed-feature.json'));
    const restored = replayForecast(copy, path.join(dir, 'restored'));
    expect(readFileSync(path.join(dir, 'restored/installed-feature.json'))).toEqual(installedBefore);
    expect(restored.investigations).toEqual(record);
    const rendered = execFileSync('pkl', ['eval', '-f', 'json', path.join(ROOT, 'tutorial-app/src/stories/ForecastReplay.pkl'), '-p', 'capture=' + path.join(dir, 'restored/capture.json'), '-p', 'bundle=' + path.join(dir, 'restored') + '/'], { encoding: 'utf8', stdio: 'pipe' });
    expect(rendered).toBe(readFileSync(path.join(ROOT, 'tutorial-app/src/stories/forecast-replay.json'), 'utf8'));

    expect(readFileSync(path.join(dir, 'restored/inputs/rounds/20261006T065648Z-stub/monitor.json'))).toEqual(readFileSync(path.join(copy, 'inputs/rounds/20261006T065648Z-stub/monitor.json')));
  }));
  it('rejects missing or changed retained evidence', () => temporary((dir) => {
    for (const changed of [false, true]) {
      const copy = path.join(dir, String(changed)); cpSync(FORECAST_BUNDLE, copy, { recursive: true });
      const file = path.join(copy, 'inputs/rounds/20261006T065648Z-stub/monitor.json');
      if (changed) writeFileSync(file, '[]'); else unlinkSync(file);
      expect(() => replayForecast(copy, path.join(dir, 'out-' + changed))).toThrow();
    }
  }));
  it('rejects an invented answer even when its schema is valid', () => temporary((dir) => {
    const copy = path.join(dir, 'retained'); cpSync(FORECAST_BUNDLE, copy, { recursive: true });
    const invented = structuredClone(record); invented['was-i-vulnerable'].records[1].answer = 1;
    writeFileSync(path.join(copy, 'record.json'), JSON.stringify(invented));
    expect(() => replayForecast(copy, path.join(dir, 'restored'))).toThrow(/differs from retained sources/);
  }));
  it('decodes Jev probabilities and rejects a checker answer for that judge', () => temporary((dir) => {
    const raw = JSON.parse(readFileSync(path.join(FORECAST_BUNDLE, 'capture.json'), 'utf8'));
    const file = path.join(dir, 'capture.json');
    raw.investigations['was-i-vulnerable'].records[1].answer = 0.7;
    writeFileSync(file, JSON.stringify(raw));
    const decoded = JSON.parse(execFileSync('pkl', ['eval', MODULE, '-p', 'capture=' + file], { encoding: 'utf8', stdio: 'pipe' }));
    expect(decoded['was-i-vulnerable'].records[1].answer).toBe(0.7);
    raw.investigations['was-i-vulnerable'].records[1].answer = { exitCode: 0, testsPassed: null, testsTotal: null, assertsPassed: null, assertsTotal: null };
    writeFileSync(file, JSON.stringify(raw));
    expect(() => execFileSync('pkl', ['eval', MODULE, '-p', 'capture=' + file], { stdio: 'pipe' })).toThrow();
  }));
});
