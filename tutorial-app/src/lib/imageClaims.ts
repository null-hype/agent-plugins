// CIT-392 (image slice): a deterministic checker for uploaded images. It makes
// no judgement call and runs no model. Each finding is a fact about the bytes:
// the file is, or is not, what its name and its embedded scene claim it is.
//
// The three checks, in the order a reviewer would ask them:
//   1. declared type vs magic bytes — a `.png` must begin with the PNG
//      signature. A MATLAB or other file renamed `.png` is the exact mismatch
//      a server trusts when it keeps a client-declared content type.
//   2. active content in SVG — a `<script>`, an `on*=` handler, or a reference
//      to a remote resource. Reported, never executed.
//   3. embedded scene vs the image — for an Excalidraw PNG, every asset the
//      scene references must be present, and the scene must fit inside the
//      image that claims to depict it.
//
// The result is a `CheckerResult` with `origin: 'executed'`: these findings
// come from running this checker on the bytes, not from sample output. The
// result shape matches CIT-392's `restoredInvestigation`, so that module can
// import these types to feed an executed result into the investigation view;
// they are defined here so the checker stands alone.
export type CheckerFinding = { path: string; line: number; message: string };

export type CheckerResult = {
  checker: { name: string; version: string };
  /** `executed`: produced by running the checker on the bytes. `illustrative`: sample output. */
  origin: 'executed' | 'illustrative';
  findings: CheckerFinding[];
  /** The checker's raw output, kept as evidence. */
  raw: string;
};

export const IMAGE_CLAIMS_VERSION = '0.1.0';

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

/** Extensions that assert a binary raster type, and the signature that proves it. */
const RASTER_BY_EXT: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };

const extensionOf = (path: string) => (path.split('.').pop() ?? '').toLowerCase();

const asText = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

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

/** Read the Excalidraw scene from a PNG `tEXt` chunk, or null if there isn't one. */
function embeddedScene(bytes: Uint8Array): { width: number; height: number; scene: any } | null {
  if (!SIGNATURES[0].test(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let scene: any = null;
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = view.getUint32(i);
    const type = asText(bytes.subarray(i + 4, i + 8));
    const data = bytes.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(i + 8);
      height = view.getUint32(i + 12);
    } else if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && asText(data.subarray(0, nul)) === EXCALIDRAW_KEYWORD) {
        try {
          scene = JSON.parse(asText(data.subarray(nul + 1)));
        } catch {
          scene = 'unparseable';
        }
      }
    }
    i += 12 + len;
  }
  return scene === null ? null : { width, height, scene };
}

function checkScene(path: string, bytes: Uint8Array): CheckerFinding[] {
  const embedded = embeddedScene(bytes);
  if (!embedded) return [];
  const { width, height, scene } = embedded;
  if (scene === 'unparseable') return [{ path, line: 1, message: 'embedded Excalidraw scene does not parse' }];

  const findings: CheckerFinding[] = [];
  const elements: any[] = Array.isArray(scene.elements) ? scene.elements : [];
  const files = scene.files && typeof scene.files === 'object' ? scene.files : {};

  for (const el of elements) {
    if (el && el.fileId && !(el.fileId in files)) {
      findings.push({ path, line: 1, message: `embedded scene references asset ${el.fileId}, which is not in the file` });
    }
  }

  // Conservative: only flag when the scene cannot fit inside the image it claims
  // to depict. No padding or scale assumptions, so no false positive from a
  // normal export.
  const sceneWidth = Math.max(0, ...elements.map((e) => (e?.x ?? 0) + (e?.width ?? 0)));
  const sceneHeight = Math.max(0, ...elements.map((e) => (e?.y ?? 0) + (e?.height ?? 0)));
  if (width > 0 && height > 0 && (sceneWidth > width || sceneHeight > height)) {
    findings.push({
      path,
      line: 1,
      message: `embedded scene is ${Math.round(sceneWidth)}×${Math.round(sceneHeight)}, larger than the ${width}×${height} image`,
    });
  }
  return findings;
}

/** Run the three checks over one file's bytes. */
export function checkImage(path: string, bytes: Uint8Array): CheckerFinding[] {
  return [...checkDeclaredType(path, bytes), ...checkActiveSvg(path, bytes), ...checkScene(path, bytes)];
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
