// Narrow, offline checks. No finding means only that these checks found nothing;
// it does not establish that a file is valid, safe, or matches its rendered pixels.
import { unzlibSync, strFromU8 } from 'fflate';

export type CheckerFinding = { path: string; line: number; message: string };

export type CheckerResult = {
  checker: { name: string; version: string };
  /** `executed`: produced by running the checker on the bytes. `illustrative`: sample output. */
  origin: 'executed' | 'illustrative';
  findings: CheckerFinding[];
  /** The checker's raw output, kept as evidence. */
  raw: string;
};

export const IMAGE_CLAIMS_VERSION = '0.2.0';

/** The Excalidraw scene is stored in a PNG `tEXt` chunk under this keyword. */
const EXCALIDRAW_KEYWORD = 'application/vnd.excalidraw+json';

type Signature = { type: string; test: (b: Uint8Array) => boolean };

const startsWith = (b: Uint8Array, bytes: number[]) => bytes.every((v, i) => b[i] === v);

const SIGNATURES: Signature[] = [
  { type: 'png', test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { type: 'jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { type: 'gif', test: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  { type: 'webp', test: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]) },
];

/** Extensions that assert a binary raster type, and its expected leading signature. */
const RASTER_BY_EXT: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };

const extensionOf = (path: string) => (path.split('.').pop() ?? '').toLowerCase();

const asText = (b: Uint8Array) => Array.from(b, (n) => String.fromCharCode(n)).join('');

/** The type the bytes actually are, by magic number; `svg` and `unknown` are text. */
function actualType(bytes: Uint8Array): string {
  for (const s of SIGNATURES) if (s.test(bytes)) return s.type;
  const head = asText(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'svg';
  return 'unknown';
}

function checkDeclaredType(path: string, bytes: Uint8Array): CheckerFinding[] {
  const ext = extensionOf(path);
  const expected = RASTER_BY_EXT[ext];
  if (!expected) return [];
  const actual = actualType(bytes);
  if (actual === expected) return [];
  return [{ path, line: 1, message: `declared .${ext} but the bytes are ${actual === 'unknown' ? 'not a known image type' : actual}` }];
}

/** Each pattern that makes an SVG active, with a short reason. Reported, not run. */
const SVG_ACTIVE: { re: RegExp; why: string }[] = [
  { re: /<script[\s>]/i, why: 'inline <script>' },
  { re: /\son[a-z]+\s*=/i, why: 'an on* event handler' },
  { re: /(?:href|xlink:href|src)\s*=\s*["']?\s*https?:/i, why: 'a remote resource reference' },
];

function checkActiveSvg(path: string, bytes: Uint8Array): CheckerFinding[] {
  if (extensionOf(path) !== 'svg' && actualType(bytes) !== 'svg') return [];
  const lines = asText(bytes).split('\n');
  const findings: CheckerFinding[] = [];
  lines.forEach((text, i) => {
    for (const { re, why } of SVG_ACTIVE) if (re.test(text)) findings.push({ path, line: i + 1, message: `active content: ${why}` });
  });
  return findings;
}

/** Decode both legacy scenes and Excalidraw's compressed bstring envelope. */
function decodeScene(data: Uint8Array): any {
  const value = JSON.parse(asText(data));
  if (value && 'encoded' in value) {
    if (value.encoding !== 'bstring' || typeof value.encoded !== 'string' || typeof value.compressed !== 'boolean') throw new Error('unsupported encoding');
    const encoded = Uint8Array.from(value.encoded, (c: string) => c.charCodeAt(0));
    return JSON.parse(strFromU8(value.compressed ? unzlibSync(encoded) : encoded));
  }
  return value;
}

function checkScene(path: string, bytes: Uint8Array): CheckerFinding[] {
  if (!SIGNATURES[0].test(bytes)) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const findings: CheckerFinding[] = [];
  for (let i = 8; i + 12 <= bytes.length;) {
    const len = view.getUint32(i);
    if (len > bytes.length - i - 12) {
      return [...findings, { path, line: 1, message: 'PNG chunk is truncated; embedded scene check incomplete' }];
    }
    const type = asText(bytes.subarray(i + 4, i + 8));
    const data = bytes.subarray(i + 8, i + 8 + len);
    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && asText(data.subarray(0, nul)) === EXCALIDRAW_KEYWORD) {
        try {
          const scene = decodeScene(data.subarray(nul + 1));
          if (!scene || !Array.isArray(scene.elements)) throw new Error('missing elements');
          const files = scene.files ?? {};
          if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('invalid files');
          for (const el of scene.elements) {
            if (el && !el.isDeleted && el.fileId && !Object.hasOwn(files, el.fileId)) {
              findings.push({ path, line: 1, message: `embedded scene references asset ${el.fileId}, which is not in the file` });
            }
          }
        } catch {
          findings.push({ path, line: 1, message: 'embedded Excalidraw scene cannot be decoded; asset check incomplete' });
        }
      }
    }
    i += 12 + len;
  }
  // Scene coordinates and PNG pixels have independent origins and export scales.
  // Their dimensions alone cannot establish a visual mismatch.
  return findings;
}

/** Same header predicates as vendor/lib/crafted_mat_file.rb (CIT-294).
 * This identifies conflicting loader dispatch claims, not a confirmed file read.
 */
export function matlabHeaderVerdict(bytes: Uint8Array): 'unreadable' | 'clean' | 'mat_level5' | 'crafted' {
  if (bytes.length < 128) return 'unreadable';
  if (asText(bytes.subarray(0, 10)) !== 'MATLAB 5.0') return 'clean';
  const tag = bytes.subarray(124, 128);
  return startsWith(tag, [0, 2, 73, 77]) || startsWith(tag, [2, 0, 77, 73]) ? 'crafted' : 'mat_level5';
}

function checkMatlab(path: string, bytes: Uint8Array): CheckerFinding[] {
  return matlabHeaderVerdict(bytes) === 'crafted'
    ? [{ path, line: 1, message: 'conflicting MATLAB headers: libvips selects matload, while matio selects the MAT 7.3/HDF5 reader; inspect loader policy' }]
    : [];
}

/** Run the limited checks over one file's bytes. */
export function checkImage(path: string, bytes: Uint8Array): CheckerFinding[] {
  return [...checkMatlab(path, bytes), ...checkDeclaredType(path, bytes), ...checkActiveSvg(path, bytes), ...checkScene(path, bytes)];
}

/** Run the checker over a set of files and return one executed `CheckerResult`. */
export function runImageClaims(files: { path: string; bytes: Uint8Array }[]): CheckerResult {
  const findings = files.flatMap((f) => checkImage(f.path, f.bytes));
  const raw = [
    `image-claims ${IMAGE_CLAIMS_VERSION}: ${files.length} file(s), ${findings.length} finding(s)`,
    ...findings.map((f) => `${f.path}:${f.line}  ${f.message}`),
  ].join('\n');
  return { checker: { name: 'image-claims', version: IMAGE_CLAIMS_VERSION }, origin: 'executed', findings, raw };
}
