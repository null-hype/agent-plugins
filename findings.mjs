import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A run, as witness reads it: .witness/run/findings.json under the harness
// root, each finding on the line that owns it, with its evidence beside it.
// https://github.com/null-hype/witness

const EVIDENCE = ['state.json', 'request.json', 'response.json'];

const sourceHash = (root, file) => {
  const p = path.join(root, file);
  return existsSync(p) ? 'sha256:' + createHash('sha256').update(readFileSync(p)).digest('hex') : undefined;
};
const firstLine = (s) => String(s).split('\n')[0];

/** The findings a question run yields: one per question whose answer is not
 * simply in range, on the test that asked it. A canned answer says so. */
export function questionFindings(comparison, backends = {}) {
  const out = [];
  for (const [id, q] of Object.entries(comparison.questions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!q.location) continue;
    const answerer = backends[id] === 'mock' ? 'canned answer' : 'Jev';
    const base = { id, location: q.location, evidence: EVIDENCE.map((f) => `questions/${id}/${f}`) };
    if (q.outcome === 'out-of-range') {
      out.push({ ...base, severity: 'warning', message: `${id}: ${answerer} ${q.probability}, outside expected [${q.expected.min}, ${q.expected.max}]` });
    } else if (q.outcome === 'execution-failed') {
      out.push({ ...base, severity: 'error', message: `${id}: answer could not be collected${q.error ? ': ' + firstLine(q.error) : ''}` });
    } else if (q.outcome === 'dependency-skipped') {
      out.push({ ...base, severity: 'information', message: `${id}: skipped, blocked by ${q.blockedBy.join(', ')}`, evidence: [] });
    }
  }
  return out;
}

/** The findings of failed tests: each on its deepest failed step that has a
 * location, else on the test, with the result's file attachments as evidence. */
export function failureFindings(root, results) {
  const out = [];
  for (const { test, result, project } of results) {
    if (result.status === 'passed' || result.status === 'skipped') continue;
    let at = test.location, error = result.errors?.[0]?.message ?? result.status;
    const deepest = (steps) => {
      for (const s of steps ?? []) {
        if (!s.error) continue;
        if (s.location) { at = s.location; error = s.error.message ?? error; }
        deepest(s.steps);
        return;
      }
    };
    deepest(result.steps);
    const id = `${project}: ${test.title}`;
    out.push({
      id, severity: 'error', message: `${test.title}: ${firstLine(error)}`,
      location: { file: path.relative(root, at.file), line: at.line, column: at.column },
      evidence: result.attachments.filter((a) => a.path).map((a) => ({ name: `failures/${project}/${path.basename(a.path)}`, from: a.path })),
    });
  }
  return out;
}

/** Replaces <root>/.witness/run in one rename, so witness never reads a half-written run. */
export function writeWitnessRun(root, findings, evidenceDir) {
  const dest = path.join(root, '.witness', 'run');
  const tmp = `${dest}.${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const written = findings.map((f) => {
    const evidence = [];
    for (const e of f.evidence ?? []) {
      const [name, from] = typeof e === 'string' ? [e, path.join(evidenceDir, e)] : [e.name, e.from];
      if (!existsSync(from)) continue;
      mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true });
      copyFileSync(from, path.join(tmp, name));
      evidence.push(name);
    }
    const hash = sourceHash(root, f.location.file);
    return { ...f, ...(hash && { sourceHash: hash }), evidence };
  });
  writeFileSync(path.join(tmp, 'findings.json'), JSON.stringify({ version: 1, findings: written }, null, 2) + '\n');
  rmSync(dest, { recursive: true, force: true });
  renameSync(tmp, dest);
  return dest;
}
