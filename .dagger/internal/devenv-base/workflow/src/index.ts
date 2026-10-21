// The supervisor's Render Workflow (CIT-472). Calibration runs `plan` and
// `apply` on the local task server (`render workflows dev -- npm start`)
// before anything is merged:
//
// - `plan` reads the open issues from Linear and returns the DAG built back
//   from what gets published, with Triage Intelligence's hints for the
//   Triage issues. Read-only.
// - `apply` makes Linear match the committed changeset.json, which planning
//   wrote and the maintainer merged. Merging is applying: the deployed
//   workflow converges Linear to main. Calibration runs it with dryRun, its
//   test; it writes only when called with dryRun false.
//
// After apply, the work itself:
//
// - `run` takes every ready cluster of the committed changeset and runs
//   `execute` for each, on its own compute;
// - `execute` runs one cluster as a fresh Claude Code session, worn by the
//   hat planning gave it, on its model and effort, with that hat's tools;
// - `host` and `ship` reach the toolbox directly, without a model.
//
// `run` and `execute` are dry by default and return the prompt they would
// run.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { apply as applyChangeset, marker, type ApplyResult } from "./apply.ts";
import type { Changeset } from "./changeset.ts";
import { plan as buildPlan, type Plan } from "./dag.ts";
import { checkPass, claudeArgs, prompt, readyClusters, runClaude, type ExecuteResult, type ReadyCluster } from "./execute.ts";
import { linearClient, openIssues, triageHints } from "./linear.ts";
import { toolboxClient, type ToolResult } from "./toolbox.ts";

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
};
const linearKey = () => env("LINEAR_API_KEY");

task(
  { name: "plan", retry: { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 } },
  async function plan(_ctx: TaskContext, team: string = "CIT", deliveries: string[] = ["CIT-439"]): Promise<Plan> {
    const [issues, hints] = await Promise.all([openIssues(linearKey(), team), triageHints(linearKey(), team)]);
    return { ...buildPlan(issues, deliveries), hints };
  },
);

// No retries: apply is idempotent, but a run that failed halfway should be
// looked at before it is run again, not repeated blind. Render retries a
// task that names no policy, so this one says zero.
task(
  { name: "apply", retry: { maxRetries: 0, waitDurationMs: 0, backoffScaling: 1 } },
  async function apply(
    _ctx: TaskContext,
    dryRun: boolean = true,
    team: string = "CIT",
    changeset: string = "changeset.json",
  ): Promise<ApplyResult> {
    // The committed changeset.json sits next to package.json, rendered from
    // changeset.pkl; dist/ is one level down. Another file is named relative
    // to the same place, for the smoke test, and may not leave it.
    if (!/^[a-z0-9][a-z0-9._/-]*\.json$/.test(changeset) || changeset.includes("..")) {
      throw new Error(`changeset must be a .json file inside the workflow, got ${changeset}`);
    }
    return applyChangeset(await readChangeset(changeset), linearClient(linearKey(), team), { dryRun });
  },
);

// Files next to package.json; dist/ is one level down.
const readChangeset = async (file = "changeset.json") =>
  JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8")) as Changeset;

// The committed changeset's clusters that are ready in Linear now. A new
// cluster is found by the marker apply wrote into it; one apply has not
// created yet is not ready.
async function ready(team: string): Promise<ReadyCluster[]> {
  const cs = await readChangeset();
  const linear = linearClient(linearKey(), team);
  const resolved: Record<string, string> = {};
  for (const c of cs.clusters) {
    const found = c.key.startsWith("new:") ? (await linear.findByMarker(marker(c.key)))?.identifier : c.key;
    if (found) resolved[c.key] = found;
  }
  return readyClusters(buildPlan(await openIssues(linearKey(), team), ["CIT-439"]), cs, resolved);
}

// One ready cluster, worn by its hat, on its model and effort. A dry run
// returns the prompt it would run instead of running it. No retries: a
// session that failed halfway has already moved issues, so a person looks
// at it before it runs again.
const execute = task(
  { name: "execute", timeoutSeconds: 3600, retry: { maxRetries: 0, waitDurationMs: 0, backoffScaling: 1 } },
  async function execute(_ctx: TaskContext, cluster: string, dryRun: boolean = true, team: string = "CIT"): Promise<ExecuteResult> {
    const c = (await ready(team)).find((r) => r.key === cluster || r.issue === cluster);
    if (!c) throw new Error(`cluster ${cluster} is not a ready cluster of the committed changeset`);
    const template = await readFile(new URL("../execute.md", import.meta.url), "utf8");
    const text = prompt(template, c, new Date().toISOString());
    const base = { cluster: c.issue, hat: c.hat, model: c.model, effort: c.effort, dryRun };
    if (dryRun) return { ...base, pass: "", tail: text };

    // The bearer tokens reach claude through this file, never its argv.
    const dir = await mkdtemp(join(tmpdir(), "execute-"));
    const mcpFile = join(dir, "mcp.json");
    try {
      await writeFile(
        mcpFile,
        JSON.stringify({
          mcpServers: {
            toolbox: { type: "http", url: process.env.TOOLBOX_URL ?? "https://toolbox-spike.onrender.com/mcp", headers: { Authorization: `Bearer ${env("TOOLBOX_TOKEN")}` } },
            linear: { type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: `Bearer ${linearKey()}` } },
          },
        }),
      );
      await chmod(mcpFile, 0o600);
      env("CLAUDE_CODE_OAUTH_TOKEN");
      const out = await runClaude(claudeArgs(c, text, mcpFile), 55 * 60 * 1000);
      return { ...base, pass: checkPass(c, out), tail: out.slice(-4000) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

// Every ready cluster at once, each as its own `execute` run on its own
// compute. Dry by default: a dry run shows what would run, and runs nothing.
task(
  { name: "run", timeoutSeconds: 3900, retry: { maxRetries: 0, waitDurationMs: 0, backoffScaling: 1 } },
  async function run(ctx: TaskContext, dryRun: boolean = true, team: string = "CIT", only: string[] = []) {
    // `only` narrows the run to the named clusters, by key or issue: how a
    // first real run is kept to one cluster, and work another thread owns is
    // kept out.
    const clusters = (await ready(team)).filter((c) => !only.length || only.includes(c.key) || only.includes(c.issue));
    const results = await Promise.allSettled(clusters.map((c) => ctx.run(execute, c.key, dryRun, team)));
    return results.map((r, i) =>
      r.status === "fulfilled" ? r.value : { cluster: clusters[i]!.issue, hat: clusters[i]!.hat, error: String(r.reason) },
    );
  },
);

// The host and ship, for a task or a person, without a model. Only the
// toolbox tools in toolbox.ts's TASK_TOOLS can be reached this way.
const toolbox = () => toolboxClient(env("TOOLBOX_TOKEN"), process.env.TOOLBOX_URL);

// The toolbox owns the host's lifecycle: `wake` starts it and waits for
// ready, `stop` refuses while a job runs, and idle stop happens on the host.
task({ name: "host" }, async function host(_ctx: TaskContext, action: "status" | "wake" | "start" | "stop" = "status"): Promise<ToolResult> {
  if (!["status", "wake", "start", "stop"].includes(action)) throw new Error(`host action must be status, wake, start or stop, got ${action}`);
  return toolbox().call(`host_${action}` as "host_status" | "host_wake" | "host_start" | "host_stop");
});

task({ name: "ship" }, async function ship(_ctx: TaskContext, environment: string, branch: string): Promise<ToolResult> {
  return toolbox().call("agent_ship", { env: environment, branch });
});

task({ name: "ship_status" }, async function shipStatus(_ctx: TaskContext): Promise<ToolResult> {
  return toolbox().call("agent_ship_status");
});
