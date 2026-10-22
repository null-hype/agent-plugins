// Execute (CIT-472): after apply, each ready cluster runs as its own
// workflow task, worn by the hat planning gave it, on the model and effort
// planning sized it at. The cluster's hat, model and effort live in the
// committed changeset; whether it is ready lives in Linear, through the
// plan. A run works that one cluster, moves its own issues, and hands
// whatever is left back to Triage for the next calibration.
import { spawn } from "node:child_process";
import type { Changeset, Cluster, Hat } from "./changeset.ts";
import type { Plan } from "./dag.ts";

// The standing `Dispatch: <hat>` issue whose description holds each hat's
// duties, so they change without a deploy.
export const DISPATCH: Record<Hat, string> = { infra: "CIT-481", "open-source": "CIT-479" };

export interface ReadyCluster {
  key: string;
  issue: string; // the cluster's parent issue in Linear
  title: string;
  hat: Hat;
  model: Cluster["model"];
  effort: Cluster["effort"];
  issues: string[];
}

// At most this many infra clusters run per tick, so plumbing cannot crowd
// out the feature work it exists to deliver. One host, one agent.
export const INFRA_PER_TICK = 1;

// What the feature work serves (supervisor/prompt.md names the same): the Duo
// editor's Release and its delivery issue. Building a feature needs the
// infra hat, which delegates it to the agent and ships it, so an infra
// cluster that serves one of these is feature work, not plumbing.
export const FEATURE_SINKS = new Set(["release:duo-editor", "CIT-439"]);

// The clusters whose parent issue the plan says is ready: accepted, and
// blocked by nothing open. `resolved` maps a cluster key to its issue, as
// apply returned it or as its marker finds it. Open-source clusters come
// first. An infra cluster runs only when it builds a feature or blocks
// something in the plan, feature first, and at most INFRA_PER_TICK do.
export function readyClusters(plan: Plan, cs: Changeset, resolved: Record<string, string>): ReadyCluster[] {
  const ready = new Set(plan.order.filter((p) => p.status === "ready").map((p) => p.id));
  const blocking = new Set(plan.order.flatMap((p) => p.blockedBy));
  const all = cs.clusters
    .filter((c) => resolved[c.key] && ready.has(resolved[c.key]!))
    .map((c) => ({ key: c.key, issue: resolved[c.key]!, title: c.title, hat: c.hat, model: c.model, effort: c.effort, issues: c.issues, serves: c.serves }));
  const infra = all.filter((c) => c.hat === "infra");
  const picked = [
    ...infra.filter((c) => FEATURE_SINKS.has(c.serves)),
    ...infra.filter((c) => !FEATURE_SINKS.has(c.serves) && blocking.has(c.issue)),
  ].slice(0, INFRA_PER_TICK);
  return [...all.filter((c) => c.hat === "open-source"), ...picked].map(({ serves: _, ...c }) => c);
}

const READ_TOOLBOX = ["mcp__toolbox__ping", "mcp__toolbox__host_status", "mcp__toolbox__workspace_list", "mcp__toolbox__workspace_status", "mcp__toolbox__agent_ship_status", "mcp__toolbox__codex_review_status"];
const WRITE_TOOLBOX = [
  "mcp__toolbox__host_wake",
  "mcp__toolbox__host_start",
  "mcp__toolbox__host_stop",
  "mcp__toolbox__agent_start",
  "mcp__toolbox__workspace_up",
  "mcp__toolbox__workspace_stop",
  "mcp__toolbox__agent_ship",
  "mcp__toolbox__codex_review",
];
// Never, for any hat: losing work, moving someone's codespace, and every
// way around the MCP allowlist (with Bash the model could curl the toolbox).
const NEVER = [
  "mcp__toolbox__workspace_delete",
  "mcp__toolbox__codespace_start",
  "mcp__toolbox__codespace_stop",
  "mcp__toolbox__codespace_rebuild",
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
  "WebFetch",
  "Task",
];

// Infra moves the host and ships; open source drafts in Linear and only
// looks at the host. Both allowlist and denylist name every toolbox write,
// so a list that fails open still cannot move anything it should not.
export function toolPolicy(hat: Hat): { allowed: string[]; disallowed: string[] } {
  return hat === "infra"
    ? { allowed: ["mcp__linear", ...READ_TOOLBOX, ...WRITE_TOOLBOX], disallowed: NEVER }
    : { allowed: ["mcp__linear", ...READ_TOOLBOX], disallowed: [...WRITE_TOOLBOX, ...NEVER] };
}

export function prompt(template: string, c: ReadyCluster, now: string): string {
  const fill: Record<string, string> = {
    NOW: now,
    HAT: c.hat,
    DISPATCH: DISPATCH[c.hat],
    CLUSTER: c.issue,
    TITLE: c.title,
    ISSUES: c.issues.join(", "),
  };
  return template.replace(/\{\{([A-Z]+)\}\}/g, (m, k: string) => fill[k] ?? m);
}

// The variadic tool lists come last, or --allowedTools would swallow what
// follows it.
export function claudeArgs(c: ReadyCluster, text: string, mcpFile: string): string[] {
  const { allowed, disallowed } = toolPolicy(c.hat);
  return [
    "-p",
    text,
    "--model",
    c.model,
    "--effort",
    c.effort,
    "--mcp-config",
    mcpFile,
    "--strict-mcp-config",
    "--allowedTools",
    ...allowed,
    "--disallowedTools",
    ...disallowed,
  ];
}

export const PASS = /^SUPERVISOR_PASS: hat=(\S+) cluster=(\S+) outcome=(done|handed-off|blocked)\b.*$/m;

export interface ExecuteResult {
  cluster: string;
  hat: Hat;
  model: string;
  effort: string;
  dryRun: boolean;
  // The run's SUPERVISOR_PASS line; empty in a dry run.
  pass: string;
  // The end of what the session said, for the record.
  tail: string;
}

// A run that does not end with its pass line for this cluster failed,
// whatever claude's exit code: there is no telling what it left behind.
export function checkPass(c: ReadyCluster, out: string): string {
  const m = PASS.exec(out);
  if (!m) throw new Error(`cluster ${c.issue}: the ${c.hat} run printed no SUPERVISOR_PASS line`);
  if (m[1] !== c.hat || m[2] !== c.issue) throw new Error(`cluster ${c.issue}: the pass line is for ${m[1]} ${m[2]}: ${m[0]}`);
  return m[0];
}

export function runClaude(args: string[], timeoutMs: number, bin = "claude"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude ${signal ? `was stopped (${signal})` : `exited ${code}`}: ${(err || out).slice(-2000)}`));
    });
  });
}
