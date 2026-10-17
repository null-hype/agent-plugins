import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { checkImage, runImageClaims, matlabHeaderVerdict } from './imageClaims';
const dir = new URL('../stories/fixtures/image-claims/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, dir));
const caseDir = new URL('../../../docs/investigations/CIT-265/cit-294/', import.meta.url);
const observation = (arm: string) => JSON.parse(readFileSync(new URL(`observations/${arm}.json`, caseDir), 'utf8'));
// Independent Node zlib encoder; preserve PNG lengths and CRCs.
function scenePng(scene: unknown) {
  const source = bytes('scene-ok.png');
  const envelope = { version: '1', encoding: 'bstring', compressed: true,
    encoded: deflateSync(Buffer.from(JSON.stringify(scene))).toString('latin1') };
  const data = Buffer.from('application/vnd.excalidraw+json\0' + JSON.stringify(envelope), 'latin1');
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write('tEXt', 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  const parts = [source.subarray(0, 8)];
  for (let i = 8; i < source.length;) {
    const end = i + 12 + source.readUInt32BE(i);
    parts.push(source.toString('ascii', i + 4, i + 8) === 'tEXt' ? chunk : source.subarray(i, end)); i = end;
  }
  return Buffer.concat(parts);
}
it('checks the exact canary used by both retained Rails arms', () => {
  const canary = bytes('rails-canary.png');
  const sha = createHash('sha256').update(canary).digest('hex');
  for (const arm of ['mat-unblocked', 'mat-blocked']) expect(sha).toBe(observation(arm).independent_source_sha256);
  expect(matlabHeaderVerdict(canary)).toBe('crafted');
  expect(checkImage('rails-canary.png', canary)).toHaveLength(2);
  expect(checkImage('canary.mat', canary)[0].message).toContain('conflicting MATLAB headers');
});
it('distinguishes genuine MAT header combinations and a PNG control', () => {
  const level5 = Buffer.from(bytes('rails-canary.png')); level5.set([0, 1, 73, 77], 124);
  expect(matlabHeaderVerdict(level5)).toBe('mat_level5');
  level5.set([2, 0, 77, 73], 124);
  expect(matlabHeaderVerdict(level5)).toBe('crafted');
  expect(matlabHeaderVerdict(level5.subarray(0, 127))).toBe('unreadable');
  const mat73 = Buffer.from(bytes('rails-canary.png')); mat73.write('MATLAB 7.3');
  expect(matlabHeaderVerdict(mat73)).toBe('clean');
  expect(matlabHeaderVerdict(bytes('diagram.png'))).toBe('mat_level5');
  expect(checkImage('control.png', bytes('control.png'))).toEqual([]);
});
it('accepts an unmodified upstream Excalidraw compressed export', () => {
  expect(checkImage('export.png', bytes('excalidraw-export.png'))).toEqual([]);
});
it('detects removal of one asset from the same compressed scene', () => {
  const scene = { elements: [{ type: 'image', fileId: 'asset', x: 10, y: 10, width: 180, height: 100 }],
    files: { asset: { dataURL: `data:image/png;base64,${bytes('control.png').toString('base64')}` } } };
  expect(checkImage('export.png', scenePng(scene))).toEqual([]);
  expect(checkImage('export.png', scenePng({ ...scene, files: {} }))).toEqual([
    { path: 'export.png', line: 1, message: 'embedded scene references asset asset, which is not in the file' },
  ]);
});
it('does not infer visual consistency from coordinates or export scale', () => {
  for (const x of [-1000, 0, 1000]) expect(checkImage('scene.png', scenePng({ elements: [{ x, y: x, width: 400, height: 300 }] }))).toEqual([]);
  expect(checkImage('scene-too-big.png', bytes('scene-too-big.png'))).toEqual([]);
});
it('reports undecodable scenes rather than treating them as empty', () => {
  expect(checkImage('scene.png', scenePng({}))[0].message).toContain('check incomplete');
});
it('retains legacy scene and SVG pattern checks', () => {
  expect(checkImage('missing.png', bytes('scene-missing-asset.png'))[0].message).toContain('img-GONE');
  expect(checkImage('badge.svg', bytes('badge.svg'))).toHaveLength(3);
});
it('labels a checker execution without claiming safety', () => {
  const result = runImageClaims([{ path: 'control.png', bytes: bytes('control.png') }]);
  expect(result.origin).toBe('executed'); expect(result.raw).toContain('0 finding(s)');
});
