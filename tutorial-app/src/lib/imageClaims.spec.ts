import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkImage, runImageClaims } from './imageClaims';

// Benign fixtures: each trips one check with nothing harmful in it. See the
// fixtures' own README.
const dir = new URL('../stories/fixtures/image-claims/', import.meta.url);
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));

describe('checkImage', () => {
  it('flags a file whose bytes are not the type its name declares', () => {
    // diagram.png is a MATLAB v5 header, not a PNG.
    const found = checkImage('diagram.png', bytes('diagram.png'));
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/declared \.png but the bytes are/);
  });

  it('flags active content in an SVG, at the line it sits on', () => {
    const found = checkImage('badge.svg', bytes('badge.svg'));
    const reasons = found.map((f) => f.message);
    expect(reasons).toContain('active content: inline <script>');
    expect(reasons).toContain('active content: an on* event handler');
    expect(reasons).toContain('active content: a remote resource reference');
    expect(found.every((f) => f.line >= 1)).toBe(true);
  });

  it('flags an embedded scene that references an asset the file does not contain', () => {
    const found = checkImage('scene-missing-asset.png', bytes('scene-missing-asset.png'));
    expect(found.map((f) => f.message)).toContain('embedded scene references asset img-GONE, which is not in the file');
  });

  it('flags an embedded scene larger than the image that claims to depict it', () => {
    const found = checkImage('scene-too-big.png', bytes('scene-too-big.png'));
    expect(found.some((f) => /larger than the 120×80 image/.test(f.message))).toBe(true);
  });

  it('passes a consistent Excalidraw PNG with no finding', () => {
    expect(checkImage('scene-ok.png', bytes('scene-ok.png'))).toEqual([]);
  });
});

describe('runImageClaims', () => {
  it('returns one executed result over a set of files', () => {
    const files = ['diagram.png', 'badge.svg', 'scene-missing-asset.png', 'scene-too-big.png', 'scene-ok.png'].map((name) => ({
      path: name,
      bytes: bytes(name),
    }));
    const result = runImageClaims(files);
    expect(result.origin).toBe('executed');
    expect(result.checker.name).toBe('image-claims');
    // Every finding names a file that was actually scanned.
    expect(result.findings.every((f) => files.some((x) => x.path === f.path))).toBe(true);
    // scene-ok.png produced nothing; the others each produced at least one.
    expect(result.findings.some((f) => f.path === 'scene-ok.png')).toBe(false);
    expect(new Set(result.findings.map((f) => f.path))).toEqual(new Set(['diagram.png', 'badge.svg', 'scene-missing-asset.png', 'scene-too-big.png']));
    expect(result.raw).toMatch(/image-claims 0\.1\.0: 5 file\(s\)/);
  });
});
