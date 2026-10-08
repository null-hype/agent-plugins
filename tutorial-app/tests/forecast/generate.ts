import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureForecast } from '../../../src/cve-2026-66066/questions/forecast/capture';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FORECAST_BUNDLE = path.join(APP, 'evidence/cit-338-forecast-v1');
export function generateForecastReplay(checkExisting = false) {
  const temporary = mkdtempSync(path.join(APP, 'evidence/.cit338-'));
  try {
    captureForecast(path.join(APP, '..'), temporary);
    const rendered = execFileSync('pkl', ['eval', '-f', 'json', path.join(APP, 'src/stories/ForecastReplay.pkl'), '-p', 'capture=' + path.join(temporary, 'capture.json'), '-p', 'bundle=' + temporary + '/'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const file = path.join(APP, 'src/stories/forecast-replay.json');
    if (checkExisting && existsSync(file) && readFileSync(file, 'utf8') !== rendered) throw new Error('Captured forecast changes the accepted presentation');
    rmSync(FORECAST_BUNDLE, { recursive: true, force: true });
    renameSync(temporary, FORECAST_BUNDLE);
    writeFileSync(file, rendered);
    return JSON.parse(rendered);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
