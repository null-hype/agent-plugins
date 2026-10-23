// CIT-518: the decision artifact is the source of truth; the PR is a view
// of it. Neither a proposed op nor an adopted recommendation is a fix.
import { readFile, writeFile } from "node:fs/promises";
import { checkContextSize, sourceRevision, type InitiativeContext, type InitiativeSource } from "./initiatives.ts";
import { OPS, type Op } from "./apply.ts";

export interface FeedbackItem {
  key: string;
  summary: string;
  disposition: "adopted" | "deferred" | "disagreed";
  rationale: string;
  status: "open" | "resolved";
  operations: { op: string; target: string }[];
  noAction: string;
  evidence: string[];
}
export interface FeedbackRecord {
  source: InitiativeSource;
  items: FeedbackItem[];
  supersededBy?: string;
}
export interface FeedbackLedger { version: 1; records: FeedbackRecord[] }
export interface FeedbackInput { initiatives: InitiativeContext[]; previous: FeedbackLedger }
const emptyLedger = (): FeedbackLedger => ({ version: 1, records: [] });
function fail(why: string): never { throw new Error(`initiative feedback: ${why}`); }
// Every problem with a planner's response, so one correction can fix them all.
export class FeedbackError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`initiative feedback:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

// CIT-523: a decision's operation names an op of this cycle's dry run, `{op,
// target}` as its table prints it. The planner writes its feedback with the
// changeset, before the dry run has named any op, so a changeset section is
// also accepted where it means exactly one op of the dry run: `cluster
// new:x` is that cluster's `create`, `cluster CIT-1` the `attach` or `parent`
// of an existing parent. Whatever names no op, or more than one, is refused.
// Stored references are always the dry run's own.
export const SECTION_OPS: Record<string, readonly Op["op"][]> = {
  cluster: ["create", "attach", "parent"], clusters: ["create", "attach", "parent"], releases: ["release"],
};
export type OpRef = { op: string; target: string };
const opKey = (o: OpRef) => `${o.op} ${o.target}`;

export function resolveOperation(ref: OpRef, proposed: OpRef[]): OpRef | string {
  if (proposed.some((p) => p.op === ref.op && p.target === ref.target)) return { op: ref.op, target: ref.target };
  const kinds = SECTION_OPS[ref.op] ?? [];
  if (!kinds.length && !(OPS as readonly string[]).includes(ref.op)) {
    return `${opKey(ref)}: ${ref.op} is not an operation (${OPS.join(", ")}) or a changeset section (${Object.keys(SECTION_OPS).join(", ")})`;
  }
  const matches = [...new Map(proposed.filter((p) => kinds.includes(p.op as Op["op"]) && p.target === ref.target).map((p) => [opKey(p), p])).values()];
  if (matches.length === 1) return { op: matches[0].op, target: matches[0].target };
  if (matches.length > 1) return `${opKey(ref)} is ambiguous in this dry run: name one of ${matches.map(opKey).join(", ")}`;
  return `${opKey(ref)} is absent from this dry run`;
}

// The references a correction may use: this dry run's ops, one per line.
export const operationReferences = (proposed: OpRef[]) => [...new Set(proposed.map(opKey))];

// What the prompt says an operation reference may name, from the lists above.
export const describeOperations = () =>
  `An operation's \`op\` is one of the dry run's own: ${OPS.map((o) => `\`${o}\``).join(", ")}, and its \`target\` is the target that op has in the dry run's table (a cluster's \`new:<slug>\` key, an issue identifier, a Release name). ` +
  `A changeset section stands for its op where it means exactly one: ${Object.entries(SECTION_OPS).map(([k, v]) => `\`${k}\` for ${v.map((o) => `\`${o}\``).join(" or ")}`).join("; ")}. Anything else is refused.`;
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

function validateItem(x: unknown): FeedbackItem {
  if (!object(x) || !text(x.key) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(x.key) || !text(x.summary) || !text(x.rationale) ||
      !["adopted", "deferred", "disagreed"].includes(String(x.disposition)) || !["open", "resolved"].includes(String(x.status)) ||
      !Array.isArray(x.operations) || !x.operations.every((o) => object(o) && text(o.op) && text(o.target)) ||
      typeof x.noAction !== "string" || !Array.isArray(x.evidence) || !x.evidence.every(text)) fail("invalid decision item");
  const item = x as unknown as FeedbackItem;
  if (!item.operations.length && !text(item.noAction)) fail(`${item.key} needs a reason for no new operation`);
  if (item.operations.length && (item.disposition !== "adopted" || item.status !== "open")) fail(`${item.key}: proposed operations must be adopted and still open`);
  if (item.status === "resolved" && !item.evidence.length) fail(`${item.key}: resolution needs evidence`);
  // Copy only the contract's fields, in stable order, rather than saving
  // arbitrary model fields or key order that would cause hourly churn.
  return {
    key: item.key, summary: item.summary, disposition: item.disposition, rationale: item.rationale,
    status: item.status, operations: item.operations.map(({ op, target }) => ({ op, target })).sort((a, b) => `${a.op}:${a.target}`.localeCompare(`${b.op}:${b.target}`)),
    noAction: item.noAction, evidence: [...item.evidence].sort(),
  };
}

function validateSource(s: unknown): asserts s is InitiativeSource {
  if (!object(s) || !text(s.id) || !text(s.initiativeId) || !["description", "update"].includes(String(s.kind)) ||
      !text(s.url) || !text(s.updatedAt) || typeof s.body !== "string" || s.revision !== sourceRevision(s.body, s.updatedAt)) fail("invalid source revision");
  const url = new URL(s.url);
  if (url.protocol !== "https:" || url.hostname !== "linear.app") fail("source URL must be on https://linear.app");
}

export function readLedger(x: unknown): FeedbackLedger {
  if (!object(x) || x.version !== 1 || !Array.isArray(x.records)) fail("invalid previous ledger");
  const keys = new Set<string>();
  for (const record of x.records) {
    if (!object(record)) fail("invalid previous record");
    validateSource(record.source);
    const key = `${record.source.id}:${record.source.revision}`;
    if (keys.has(key)) fail("duplicate previous revision");
    keys.add(key);
    if (!Array.isArray(record.items) || !record.items.length) fail("previous record has no decisions");
    record.items.forEach(validateItem);
    if (record.supersededBy !== undefined && !text(record.supersededBy)) fail("invalid supersession");
  }
  checkContextSize(x);
  return x as unknown as FeedbackLedger;
}

export function prepareFeedback(initiatives: InitiativeContext[], previous = emptyLedger()): FeedbackInput {
  if (!Array.isArray(initiatives) || !initiatives.length) fail("plan has no initiative input");
  readLedger(previous);
  const ids = new Set<string>();
  for (const initiative of initiatives) {
    if (!Array.isArray(initiative.sources) || !initiative.sources.length) fail("initiative has no sources");
    for (const s of initiative.sources) {
      validateSource(s);
      if (ids.has(s.id)) fail(`duplicate source ${s.id}`);
      ids.add(s.id);
    }
  }
  for (const r of previous.records.filter((r) => !r.supersededBy)) {
    if (!ids.has(r.source.id)) fail(`previous source ${r.source.id} is missing; reconcile it explicitly rather than dropping its decisions`);
  }
  const input = { initiatives, previous };
  checkContextSize(input);
  return input;
}

export function feedbackBlock(response: string): unknown {
  const blocks = [...response.matchAll(/^SUPERVISOR_FEEDBACK:\s*\n```json\s*\n([\s\S]*?)^```\s*$/gm)];
  if (blocks.length !== 1) fail("expected one SUPERVISOR_FEEDBACK JSON block");
  return JSON.parse(blocks[0][1]);
}

export function recordFeedback(input: FeedbackInput, response: unknown, proposed: OpRef[]): FeedbackLedger {
  prepareFeedback(input.initiatives, input.previous);
  if (!object(response) || !Array.isArray(response.decisions)) fail("expected decisions array");
  const sources = input.initiatives.flatMap((i) => i.sources);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const records = structuredClone(input.previous.records);
  const problems: string[] = [];
  for (const d of response.decisions) {
    if (!object(d) || !text(d.sourceId)) { problems.push("decision has no sourceId"); continue; }
    const source = byId.get(d.sourceId);
    if (!source || d.revision !== source.revision) { problems.push(`unknown source/revision ${d.sourceId}`); continue; }
    if (seen.has(source.id)) { problems.push(`duplicate disposition for ${source.id}`); continue; }
    seen.add(source.id);
    if (!Array.isArray(d.items) || !d.items.length) { problems.push(`no decision for ${source.id}`); continue; }
    const parsed = d.items.map((x, n) => {
      try {
        return validateItem(x);
      } catch (e) {
        problems.push(`${source.id} item ${n + 1} (${object(x) ? String(x.key) : "?"}): ${(e as Error).message.replace(/^initiative feedback: /, "")}`);
        return undefined;
      }
    });
    if (parsed.includes(undefined)) continue;
    const items = (parsed as FeedbackItem[]).sort((a, b) => a.key.localeCompare(b.key));
    if (new Set(items.map((i) => i.key)).size !== items.length) { problems.push(`duplicate recommendation key in ${source.id}`); continue; }
    const previous = records.find((r) => r.source.id === source.id && !r.supersededBy);
    if (previous) {
      // Stable keys force the next answer to account for prior recommendations,
      // including a revised update. A new revision alone cannot erase them.
      for (const item of previous.items) {
        if (!items.some((i) => i.key === item.key)) problems.push(`lost recommendation ${source.id}/${item.key}`);
      }
      if (previous.source.revision !== source.revision) {
        if (d.supersedes !== previous.source.revision) problems.push(`${source.id}: revised input must explicitly supersede the previous revision`);
        else previous.supersededBy = source.revision;
      }
    }
    for (const item of items) {
      const resolved = item.operations.map((op) => resolveOperation(op, proposed));
      for (const r of resolved) if (typeof r === "string") problems.push(`${item.key} refers to an operation absent from this dry run: ${r}`);
      item.operations = [...new Map((resolved.filter((r) => typeof r !== "string") as OpRef[]).map((o) => [opKey(o), o])).values()]
        .sort((a, b) => `${a.op}:${a.target}`.localeCompare(`${b.op}:${b.target}`));
    }
    const record = { source, items };
    const index = records.findIndex((r) => r.source.id === source.id && r.source.revision === source.revision);
    if (index >= 0) records[index] = record; else records.push(record);
  }
  for (const source of sources) if (!seen.has(source.id)) problems.push(`missing disposition for ${source.id}`);
  if (problems.length) throw new FeedbackError(problems);
  records.sort((a, b) => `${a.source.id}:${a.source.revision}`.localeCompare(`${b.source.id}:${b.source.revision}`));
  const ledger: FeedbackLedger = { version: 1, records };
  checkContextSize(ledger);
  return ledger;
}

const md = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/@/g, "&#64;").replace(/[\\`*_[\]|]/g, "\\$&").replace(/\r?\n/g, " ");

export function renderFeedback(ledger: FeedbackLedger): string {
  const lines = ["", "## Initiative feedback", "", "These are planning decisions. Proposed operations execute in a subsequent apply; adoption is not completion.", ""];
  for (const r of ledger.records.filter((r) => !r.supersededBy)) {
    lines.push(`### [${md(r.source.id)}](${encodeURI(r.source.url).replace(/\(/g, "%28").replace(/\)/g, "%29")})`, "", `Revision: \`${r.source.revision}\` (updated ${md(r.source.updatedAt)}).`, "");
    for (const i of r.items) {
      lines.push(`- **${i.disposition}; ${i.status}** — ${md(i.summary)} (${md(i.key)}). ${md(i.rationale)}`);
      lines.push(`  ${i.operations.length ? `Proposed for subsequent apply: ${i.operations.map((o) => `${md(o.op)} ${md(o.target)}`).join(", ")}.` : `No new operation: ${md(i.noAction)}`}`);
      if (i.evidence.length) lines.push(`  Evidence cited: ${i.evidence.map(md).join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...paths] = process.argv.slice(2);
  const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
  const save = async (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
  if (command === "input") {
    const [plan, previous, output] = paths;
    await save(output, prepareFeedback((await json(plan)).initiatives, readLedger(await json(previous))));
  } else if (command === "record") {
    // A rejected response leaves DIAGNOSTICS: every problem and the
    // references this dry run accepts, for the correction and the record.
    const [input, response, dry, output, diagnostics] = paths;
    const result = await json(dry);
    if (result.dryRun !== true || !Array.isArray(result.applied) || result.skipped?.length) fail("expected a successful dry run");
    try {
      await save(output, recordFeedback(await json(input), feedbackBlock(await readFile(response, "utf8")), result.applied));
    } catch (e) {
      if (diagnostics) {
        await save(diagnostics, {
          problems: e instanceof FeedbackError ? e.problems : [(e as Error).message.replace(/^initiative feedback: /, "")],
          validOperations: operationReferences(result.applied),
        });
      }
      throw e;
    }
  } else if (command === "ops") {
    process.stdout.write(describeOperations() + "\n");
  } else if (command === "render") {
    process.stdout.write(renderFeedback(readLedger(await json(paths[0]))));
  } else fail("usage: feedback.js input PLAN PREVIOUS OUT | record INPUT RESPONSE DRY OUT [DIAGNOSTICS] | render LEDGER | ops");
}
