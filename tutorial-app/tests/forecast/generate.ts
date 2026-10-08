import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORECAST_PIN, loadForecastReplay } from './captures';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FORECAST_BUNDLE = path.join(APP, 'evidence/cit-338-forecast-v1');
export function generateForecastReplay(checkExisting = false, pinFile = FORECAST_PIN, bundleOut = FORECAST_BUNDLE, presentation = path.join(APP, 'src/stories/forecast-replay.json')) {
  const retained = loadForecastReplay(pinFile);
  const temporary = mkdtempSync(path.join(APP, 'evidence/.cit338-'));
  try {
    for (const [name, bytes] of retained.files) {
      const file = path.join(temporary, name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes);
    }
    const rendered = execFileSync('pkl', ['eval', '-f', 'json', path.join(APP, 'src/stories/ForecastReplay.pkl'), '-p', 'capture=' + path.join(temporary, 'capture.json'), '-p', 'bundle=' + temporary + '/'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (checkExisting && existsSync(presentation) && readFileSync(presentation, 'utf8') !== rendered) throw new Error('Retained forecast changes the accepted presentation');
    rmSync(bundleOut, { recursive: true, force: true });
    renameSync(temporary, bundleOut);
    writeFileSync(presentation, rendered);
    return JSON.parse(rendered);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
