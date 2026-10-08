// Run inside the installed runtime against an independently restored scope.
import { deepEqual, equal, throws } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const original = '/retained/payload/bundle';
const tooling = '/usr/local/share/cve-2026-66066/src/cve-2026-66066/questions/vaults/adapter.ts';
const { derive, render, replay } = await import(pathToFileURL(tooling).href);
const execution = JSON.parse(readFileSync(path.join(original, 'execution.json'), 'utf8'));
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

Deno.test('read-only assessment replay preserves the identified execution', () => {
  const before = hash(path.join(original, 'execution.json'));
  const view = JSON.parse(render(original));
  const installed = JSON.parse(readFileSync(path.join(original, 'installed-feature.json'), 'utf8'));
  equal(installed.version, '20261008.0744');
  equal(installed.metadata.version, installed.packageVersion);
  for (const r of view.records) {
    equal(r.delivery.status, 'captured');
    equal(r.delivery.version, installed.version);
    equal(r.forecast, null);
    equal(r.observations[0].origin, 'historical');
    equal(r.observations[1].origin, 'reproduced');
  }
  equal(hash(path.join(original, 'execution.json')), before);
});

Deno.test('new offline execution agrees with original answers and generated baselines', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'vaults-check-'));
  try {
    const out = path.join(temp, 'fresh');
    const comparison = replay(original, out);
    equal(comparison.originalExecution, execution.id);
    equal(comparison.originalExecution === comparison.newExecution, false);
    deepEqual(derive(original).records.map((r: any) => r.answer), derive(out).records.map((r: any) => r.answer));
    throws(() => replay(original, out), /must be empty/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

for (const [label, uri] of [
  ['historical input', JSON.parse(readFileSync(path.join(original, 'inputs.json'), 'utf8')).states[0].files[0].evidence.uri],
  ['generated baseline', execution.runs[0].generatedBaseline.uri],
  ['raw output', execution.runs[0].check.output.uri],
  ['tool identity', 'installed-feature.json'],
  ['execution receipt', 'execution.json'],
] as const) {
  Deno.test('missing or changed ' + label + ' is refused', () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'vaults-control-'));
    try {
      const copy = path.join(temp, 'bundle');
      cpSync(original, copy, { recursive: true });
      const file = path.join(copy, uri), bytes = readFileSync(file);
      writeFileSync(file, Buffer.concat([bytes, Buffer.from('\nchanged\n')]));
      throws(() => derive(copy));
      rmSync(file);
      throws(() => derive(copy));
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
}
