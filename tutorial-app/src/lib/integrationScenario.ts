import type { EvidenceLocation, GovernanceDiagnostic } from './governanceDiagnostic';

/**
 * CIT-176: a deterministic, SYNTHETIC fixture for pre-merge composition.
 * Base + A passes a stated rule, base + B passes it, A + B merges
 * textually clean but fails it, and a revised B (B2) composes to a pass.
 *
 * Everything here is simulated: revisions are content hashes labelled
 * `sim-…`, environment names are context only, and nothing reads a real
 * container-use environment or GitButler. It proves this bounded fixture,
 * not universal data-flow detection. CIT-127/128 are the future producers
 * of real immutable revisions and observed check evidence -- see
 * `CandidateInput` for the boundary.
 */

export type Origin = 'base' | 'A' | 'B';

export const FILE_PATH = 'agent.tasks';
export const CHECK_ID = 'flow-policy@1';
export const RULE_CODE = 'POLICY_CLASS_REACHES_EXTERNAL';

// ---------------------------------------------------------------- fixture

export const BASE_TEXT = [
  '# policy',
  'deny class=pii reaching=external',
  '',
  '# extraction tasks',
  'task summarize reads=docs/notes.md class=public writes=out/summary.txt',
  '',
  '# delivery tasks',
  '',
].join('\n');

const A_LINE = 'task export-customers reads=crm/customers.db class=pii writes=out/customers.csv';
const B_LINE = 'task sync-report reads=out/*.csv sends=https://reports.partner.example';
const B2_LINE = 'task sync-report reads=out/*.csv redacts=pii sends=https://reports.partner.example';

function insertAfter(text: string, anchor: string, line: string): string {
  const lines = text.split('\n');
  const at = lines.indexOf(anchor);
  if (at < 0) throw new Error(`anchor not found: ${anchor}`);
  lines.splice(at + 1, 0, line);
  return lines.join('\n');
}

/**
 * The boundary CIT-127/128 will fill: an immutable candidate revision
 * (here simulated) plus the file content it holds. `env` is context, the
 * `revision` is the evidence identity.
 */
export interface CandidateInput {
  id: 'A' | 'B';
  title: string;
  summary: string;
  env: string;
  text: string;
  revision: string;
  simulated: true;
}

/** FNV-1a, 32-bit, twice with different seeds -> 16 hex chars. Deterministic. */
export function simRevision(...parts: string[]): string {
  const input = parts.join('\u0000');
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return `sim-${hash(0x811c9dc5)}${hash(0x9747b28c)}`.slice(0, 12);
}

function candidate(
  id: 'A' | 'B',
  title: string,
  summary: string,
  env: string,
  text: string,
): CandidateInput {
  return { id, title, summary, env, text, revision: simRevision(id, text), simulated: true };
}

export const BASE = { text: BASE_TEXT, revision: simRevision('base', BASE_TEXT), simulated: true as const };

export const CANDIDATE_A = candidate(
  'A',
  'Export customers',
  'Adds a task that ingests the customer database (class pii) and writes out/customers.csv locally.',
  'cu-env-export-customers (simulated)',
  insertAfter(BASE_TEXT, BASE_TEXT.split('\n')[4], A_LINE),
);

export const CANDIDATE_B = candidate(
  'B',
  'Sync reports',
  'Adds a task that sends every out/*.csv to an external reporting endpoint.',
  'cu-env-sync-reports (simulated)',
  insertAfter(BASE_TEXT, '# delivery tasks', B_LINE),
);

export const CANDIDATE_B_REVISED = candidate(
  'B',
  'Sync reports (redacts pii)',
  'Same task, now declaring redacts=pii before sending.',
  'cu-env-sync-reports (simulated)',
  insertAfter(BASE_TEXT, '# delivery tasks', B2_LINE),
);

export const REPAIR = {
  id: 'redact-before-send',
  title: 'Redact pii in sync-report before sending',
  description: 'Revises candidate B: the task declares redacts=pii, so class pii is removed before the external send.',
  from: CANDIDATE_B,
  to: CANDIDATE_B_REVISED,
} as const;

// ------------------------------------------------------------- 3-way merge

interface Hunk {
  baseStart: number;
  baseEnd: number;
  lines: string[];
}

/** LCS line diff of `side` against `base`, as replacement hunks over base ranges. */
export function diffHunks(base: string[], side: string[]): Hunk[] {
  const n = base.length;
  const m = side.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = base[i] === side[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === side[j]) {
      if (cur) hunks.push(cur);
      cur = null;
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      cur ??= { baseStart: i, baseEnd: i, lines: [] };
      cur.lines.push(side[j]);
      j++;
    } else {
      cur ??= { baseStart: i, baseEnd: i, lines: [] };
      cur.baseEnd = i + 1;
      i++;
    }
  }
  if (cur) hunks.push(cur);
  return hunks;
}

export interface MergedLine {
  text: string;
  origin: Origin;
}

export type MergeResult =
  | { ok: true; lines: MergedLine[]; text: string }
  | { ok: false; conflict: string };

/** Line-based three-way merge. Overlapping or touching hunks are a textual conflict. */
export function merge3(base: string, a: string, b: string): MergeResult {
  const baseLines = base.split('\n');
  const ha = diffHunks(baseLines, a.split('\n'));
  const hb = diffHunks(baseLines, b.split('\n'));
  for (const x of ha) {
    for (const y of hb) {
      if (x.baseStart <= y.baseEnd && y.baseStart <= x.baseEnd) {
        return { ok: false, conflict: `A and B both change base lines ${x.baseStart + 1}-${Math.max(x.baseEnd, x.baseStart) + 1}` };
      }
    }
  }
  const tagged = [
    ...ha.map((h) => ({ ...h, origin: 'A' as const })),
    ...hb.map((h) => ({ ...h, origin: 'B' as const })),
  ].sort((p, q) => p.baseStart - q.baseStart);
  const lines: MergedLine[] = [];
  let at = 0;
  for (const h of tagged) {
    for (; at < h.baseStart; at++) lines.push({ text: baseLines[at], origin: 'base' });
    for (const text of h.lines) lines.push({ text, origin: h.origin });
    at = h.baseEnd;
  }
  for (; at < baseLines.length; at++) lines.push({ text: baseLines[at], origin: 'base' });
  return { ok: true, lines, text: lines.map((l) => l.text).join('\n') };
}

/** What a candidate adds relative to base, with its own 1-based line numbers. */
export function contribution(base: string, candidateText: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const side = candidateText.split('\n');
  for (const h of diffHunks(base.split('\n'), side)) {
    // hunk lines start where the candidate diverges: baseStart lines matched so far, adjusted by earlier hunks
    const idx = side.indexOf(h.lines[0]);
    h.lines.forEach((text, k) => out.push({ line: idx + k + 1, text }));
  }
  return out;
}

// --------------------------------------------------------------- evaluator

export interface PathStep {
  line: number;
  task: string;
  action: string;
}

export interface Violation {
  class: string;
  destination: string;
  policyLine: number;
  path: PathStep[];
}

export interface FlowEvaluation {
  checkId: typeof CHECK_ID;
  outcome: 'pass' | 'fail';
  violations: Violation[];
}

interface Task {
  name: string;
  line: number;
  reads: string[];
  writes: string[];
  ingestClass?: string;
  redacts: string[];
  sends?: string;
}

function attrs(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of rest) {
    const eq = token.indexOf('=');
    if (eq > 0) out[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return out;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Executable flow policy over the `agent.tasks` file: a class ingested by
 * one task propagates through the files it writes into every task that
 * reads a matching path, minus what a task `redacts`; a `deny` line
 * forbids a class from reaching an external `sends=` destination. The
 * failure is established by that propagation, never by both tasks merely
 * being present.
 */
export function evaluateFlows(text: string): FlowEvaluation {
  const tasks: Task[] = [];
  const denies: { class: string; line: number }[] = [];
  text.split('\n').forEach((raw, idx) => {
    const line = idx + 1;
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === 'task' && parts[1]) {
      const a = attrs(parts.slice(2));
      tasks.push({
        name: parts[1],
        line,
        reads: a.reads ? a.reads.split(',') : [],
        writes: a.writes ? a.writes.split(',') : [],
        ingestClass: a.class,
        redacts: a.redacts ? a.redacts.split(',') : [],
        sends: a.sends,
      });
    } else if (parts[0] === 'deny') {
      const a = attrs(parts.slice(1));
      if (a.class && a.reaching === 'external') denies.push({ class: a.class, line });
    }
  });

  // labels[path][class] = provenance chain that put that class on that path
  const labels = new Map<string, Map<string, PathStep[]>>();
  const inbound = (task: Task): Map<string, PathStep[]> => {
    const acc = new Map<string, PathStep[]>();
    if (task.ingestClass) {
      acc.set(task.ingestClass, [
        { line: task.line, task: task.name, action: `ingests ${task.reads.join(', ')} as class ${task.ingestClass}` },
      ]);
    }
    for (const pattern of task.reads) {
      const re = globToRegExp(pattern);
      for (const [path, byClass] of labels) {
        if (!re.test(path)) continue;
        for (const [cls, chain] of byClass) {
          if (!acc.has(cls)) {
            acc.set(cls, [...chain, { line: task.line, task: task.name, action: `reads ${pattern} (matches ${path})` }]);
          }
        }
      }
    }
    for (const cls of task.redacts) acc.delete(cls);
    return acc;
  };

  for (let pass = 0; pass <= tasks.length; pass++) {
    let changed = false;
    for (const task of tasks) {
      const acc = inbound(task);
      for (const path of task.writes) {
        const byClass = labels.get(path) ?? new Map<string, PathStep[]>();
        for (const [cls, chain] of acc) {
          if (!byClass.has(cls)) {
            byClass.set(cls, [...chain, { line: task.line, task: task.name, action: `writes ${path}` }]);
            changed = true;
          }
        }
        labels.set(path, byClass);
      }
    }
    if (!changed) break;
  }

  const violations: Violation[] = [];
  for (const task of tasks) {
    if (!task.sends) continue;
    const acc = inbound(task);
    for (const deny of denies) {
      const chain = acc.get(deny.class);
      if (chain) {
        violations.push({
          class: deny.class,
          destination: task.sends,
          policyLine: deny.line,
          path: [...chain, { line: task.line, task: task.name, action: `sends to ${task.sends}` }],
        });
      }
    }
  }
  return { checkId: CHECK_ID, outcome: violations.length ? 'fail' : 'pass', violations };
}

// ------------------------------------------------------------- integration

export interface Integration {
  revision: string;
  merge: MergeResult;
  evaluation: FlowEvaluation | null;
}

/** Compose base + a + b. The integration revision covers every input revision. */
export function compose(a: CandidateInput, b: CandidateInput): Integration {
  const merge = merge3(BASE.text, a.text, b.text);
  return {
    revision: simRevision('integration', BASE.revision, a.revision, b.revision, merge.ok ? merge.text : merge.conflict),
    merge,
    evaluation: merge.ok ? evaluateFlows(merge.text) : null,
  };
}

export function revLoc(revision: string, path: string, line?: number): string {
  return `${path}@${revision}${line ? `:${line}` : ''}`;
}

/** What a diagnostic panel needs beyond the shared GovernanceDiagnostic. */
export interface ComparisonContext {
  baseRevision: string;
  candidates: { id: 'A' | 'B'; revision: string; env: string; added: { line: number; text: string }[] }[];
  integrationRevision: string;
  path: (PathStep & { origin: Origin })[];
  rule: { line: number; text: string };
}

/**
 * Widens a Violation into the existing GovernanceDiagnostic IR (revision-
 * qualified locations via the optional `revision`/`line` fields), plus the
 * comparison context that says who contributed what.
 */
export function violationToGovernance(
  v: Violation,
  a: CandidateInput,
  b: CandidateInput,
  integration: Integration,
): { diagnostic: GovernanceDiagnostic; comparison: ComparisonContext } {
  if (!integration.merge.ok) throw new Error('cannot diagnose a conflicted merge');
  const lines = integration.merge.lines;
  const path = v.path.map((step) => ({ ...step, origin: lines[step.line - 1]?.origin ?? 'base' }));
  const loc = (line: number, role: EvidenceLocation['role'], detail: string): EvidenceLocation => ({
    role,
    uri: FILE_PATH,
    revision: integration.revision,
    line,
    detail,
  });
  const related: EvidenceLocation[] = [
    loc(v.policyLine, 'axiom', `${lines[v.policyLine - 1].text} (base policy)`),
    ...path.map((s) => loc(s.line, 'fact', `[${s.origin}] ${s.task} ${s.action}`)),
  ];
  const ruleLine = lines[v.policyLine - 1].text;
  return {
    diagnostic: {
      code: RULE_CODE,
      severity: 'error',
      message: `class ${v.class} reaches external destination ${v.destination} through the combined change`,
      subject: loc(path[path.length - 1].line, 'fact', `${path[path.length - 1].task} ${path[path.length - 1].action}`),
      related,
      evaluationId: `${CHECK_ID}:${integration.revision}`,
    },
    comparison: {
      baseRevision: BASE.revision,
      candidates: [a, b].map((c) => ({
        id: c.id,
        revision: c.revision,
        env: c.env,
        added: contribution(BASE.text, c.text),
      })),
      integrationRevision: integration.revision,
      path,
      rule: { line: v.policyLine, text: ruleLine },
    },
  };
}
