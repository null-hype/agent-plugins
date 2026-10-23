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
// The supervisor's judgment is the Claude session in the Render cron, which
// writes the changeset. This workflow makes no model calls: apply does what
// the changeset says, and wakes the host and ships through the toolbox when
// it says to. `host` and `ship` reach the toolbox directly, for a person.
import { readFile } from "node:fs/promises";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { apply as applyChangeset, type ApplyResult } from "./apply.ts";
import type { Changeset } from "./changeset.ts";
import { plan as buildPlan, type Plan } from "./dag.ts";
import { linearClient, openIssues, triageHints } from "./linear.ts";
import { initiativeContext, BOOTSTRAP_INITIATIVES } from "./initiatives.ts";
import { shipJob, toolboxClient, wakeHost, type ToolResult } from "./toolbox.ts";

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
};
const linearKey = () => env("LINEAR_API_KEY");

task(
  { name: "plan", retry: { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 } },
  async function plan(_ctx: TaskContext, team: string = "CIT", deliveries: string[] = ["CIT-439"], initiativeIds: string[] = BOOTSTRAP_INITIATIVES): Promise<Plan> {
    const [issues, hints, initiatives] = await Promise.all([
      openIssues(linearKey(), team), triageHints(linearKey(), team), initiativeContext(linearKey(), initiativeIds),
    ]);
    return { ...buildPlan(issues, deliveries), hints, initiatives };
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
    return applyChangeset(await readChangeset(changeset), linearClient(linearKey(), team), { dryRun, toolbox: applyToolbox() });
  },
);

// What apply reaches the host with.
const applyToolbox = () => ({
  async wake() {
    const tb = toolbox();
    await wakeHost((tool, args) => tb.call(tool, args));
  },
  async ship(env: string, branch: string) {
    await toolbox().call("agent_ship", { env, branch });
  },
  async shipStatus() {
    return shipJob((await toolbox().call("agent_ship_status")).text);
  },
  async review(pr: number) {
    await toolbox().call("codex_review", { pr });
  },
});

// Files next to package.json; dist/ is one level down.
const readChangeset = async (file = "changeset.json") =>
  JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8")) as Changeset;

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
