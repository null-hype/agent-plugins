import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayForecast } from '../../../src/cve-2026-66066/questions/forecast/replay';
import { canonical, hash, withRetainedExport } from '../retained/export';
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FORECAST_PIN = path.join(APP, 'evidence/cit-338-captures-v1/bundle.json');
export function loadForecastReplay(pinFile = FORECAST_PIN) {
  return withRetainedExport(pinFile, 'cit338-viewer-export-v1', ['forecast'], /^(inputs\/|[a-z-]+\.json$)/, false, (dir, files, pin) => {
    const selected = pin.captures[0];
    const manifestBytes = readFileSync(path.join(dir, 'retention.json'));
    const manifest = JSON.parse(manifestBytes.toString());
    if (hash(manifestBytes) !== selected.retentionSha256 || manifest.snapshotId !== selected.snapshotId || canonical(manifest.image) !== canonical(selected.image) || canonical(manifest.source) !== canonical(selected.executionSource) || canonical(manifest.delivery) !== canonical(selected.delivery)) throw new Error('Retained execution identity differs');
    for (const name of ['execution.json', 'source-inputs.json', 'container-execution.json']) {
      const entry = manifest.files.find((e: any) => e.path === name);
      const bytes = files.get(name)!;
      if (!entry || entry.sha256 !== hash(bytes) || entry.bytes !== bytes.length) throw new Error('Retained execution provenance differs: ' + name);
    }
    const execution = JSON.parse(files.get('execution.json')!.toString());
    const receipt = JSON.parse(files.get('container-execution.json')!.toString());
    const sourceInputs = JSON.parse(files.get('source-inputs.json')!.toString());
    const inputPin = JSON.parse(files.get('input-pins.json')!.toString());
    if (canonical(execution.source) !== canonical(selected.executionSource) || canonical(execution.image) !== canonical(selected.image) || execution.startedAt !== selected.observationStartedAt || !execution.container.disposed || receipt.exitCode !== 0 || !receipt.reportCollected) throw new Error('Retained execution receipt differs');
    if (hash(files.get('source-inputs.json')!) !== selected.executionSource.inventorySha256 || canonical(sourceInputs.historicalInputs) !== canonical(inputPin) || hash(files.get('input-pins.json')!) !== selected.historicalInputs.pinsSha256) throw new Error('Retained source/input hashes differ');
    const installed = JSON.parse(files.get('installed-feature.json')!.toString());
    if (canonical(installed) !== canonical(selected.delivery) || installed.feature !== 'cve-2026-66066' || installed.version !== '20261008.0814' || installed.packageVersion !== '0.4.0') throw new Error('Wrong installed forecast delivery');
    const replay = replayForecast(dir);
    return { ...replay, files, pin };
  });
}
