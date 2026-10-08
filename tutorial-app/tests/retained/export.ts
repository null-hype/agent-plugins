// Common retained scenario export verification; case interpretation is supplied by the adapter.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
export const hash = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
};
export function withRetainedExport<T>(pinFile: string, format: string, states: string[], allowedPath: RegExp, prefixStates: boolean, decode: (dir: string, files: Map<string, Buffer>, pin: any) => T): T {
  const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
  if (pin.format !== format || pin.archive !== 'bundle.tar.gz') throw new Error('Unsupported replay capture');
  const archive = readFileSync(path.join(path.dirname(pinFile), pin.archive));
  if (hash(archive) !== pin.sha256 || archive.length !== pin.bytes) throw new Error('Pinned replay archive changed');
  const sourcesFile = path.join(path.dirname(pinFile), 'capture-pins.json');
  const sourceBytes = readFileSync(sourcesFile);
  const sources = JSON.parse(sourceBytes.toString());
  if (hash(sourceBytes) !== pin.capturePinsSha256 || canonical(sources.captures) !== canonical(pin.captures)) throw new Error('Canonical capture pins changed');
  if (canonical(pin.captures.map((c: any) => c.state)) !== canonical(states) || pin.captures.some((c: any) => !/^[0-9a-f]{64}$/.test(c.snapshotId) || !c.repositoryId || !c.source.artifactId)) throw new Error('Missing canonical capture identity');
  const dir = mkdtempSync(path.join(tmpdir(), 'cit337-restore-'));
  try {
    const archiveFile = path.join(path.dirname(pinFile), pin.archive);
    const names = execFileSync('tar', ['-tzf', archiveFile], { encoding: 'utf8' }).trim().split('\n');
    if (names.some((name) => !allowedPath.test(name) || name.split('/').some((p) => p === '..' || p === '') || name.startsWith('/'))) throw new Error('Unsafe replay archive path');
    const types = execFileSync('tar', ['-tvzf', archiveFile], { encoding: 'utf8' }).trim().split('\n');
    if (types.some((entry) => entry[0] !== '-')) throw new Error('Replay export must contain only regular files');
    execFileSync('tar', ['-xzf', archiveFile, '--no-same-owner', '--no-same-permissions', '-C', dir]);
    const files = new Map<string, Buffer>();
    const walk = (root: string) => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const file = path.join(root, entry.name);
        if (lstatSync(file).isSymbolicLink()) throw new Error('Replay capture contains a symlink');
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) files.set(path.relative(dir, file).split(path.sep).join('/'), readFileSync(file));
        else throw new Error('Replay capture contains a special file');
      }
    };
    walk(dir);
    const inventory = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) }));
    if (canonical(inventory) !== canonical(pin.files)) throw new Error('Restored replay inventory changed');
    for (const capture of pin.captures) for (const entry of capture.selectedFiles) {
      const uri = (prefixStates ? capture.state + '/' : '') + entry.path.slice('bundle/'.length);
      const bytes = files.get(uri);
      if (!entry.path.startsWith('bundle/') || !bytes || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('Export differs from canonical capture: ' + uri);
    }
    return decode(dir, files, pin);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
