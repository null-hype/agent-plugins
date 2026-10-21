// Calibration's client (CIT-472): runs the workflow's tasks on the local
// task server that `render workflows dev` started, and prints each result as
// JSON on stdout for supervisor.sh: the `plan` it gives planning, then the
// `apply` dry run of the changeset planning wrote, which is calibration's
// test. The SDK targets the dev server when
// RENDER_USE_LOCAL_DEV is set, so this never reaches api.render.com: there is
// nothing here that could deploy or run a task on Render itself.
//
// Usage: node dist/calibrate.js plan [team] [delivery...]
//        node dist/calibrate.js apply [team]
// CALIBRATION_TASK_PREFIX is prepended to the task names, in case the local
// server expects `<workflow>/<task>` slugs.
import { createWorkflowsClient } from "@renderinc/sdk/workflows";
import type { ApplyResult } from "./apply.ts";
import type { Plan } from "./dag.ts";

export interface TaskRunner {
  runTask(slug: string, input: unknown[]): Promise<{ status: string; results: unknown[]; error?: string }>;
}

// A run that did not finish, or finished without a plan, is a failed
// calibration, never an empty plan: an empty plan would read as "nothing to
// do tomorrow".
export async function runPlan(client: TaskRunner, slug: string, team: string, deliveries: string[]): Promise<Plan> {
  const run = await client.runTask(slug, [team, deliveries]);
  if (run.status !== "completed" && run.status !== "succeeded") {
    throw new Error(`task ${slug} ended ${run.status}${run.error ? `: ${run.error}` : ""}`);
  }
  const plan = run.results[0] as Plan | undefined;
  if (!plan || !Array.isArray(plan.order) || !Array.isArray(plan.sinks)) {
    throw new Error(`task ${slug} returned no plan`);
  }
  return plan;
}

// At most this many Releases created per calibration. A new Release is a
// new published thing, so planning proposes one at a time and otherwise
// reuses what is open, and successive calibrations stay stable.
export const MAX_NEW_RELEASES = 1;

// The changeset's dry run, always with dryRun true: calibration never
// applies. A result that claims otherwise, or that skipped an op, fails the
// calibration: a plan that cannot be applied as written is not ready to
// merge. So does one that would create more than MAX_NEW_RELEASES Releases;
// only the dry run can tell, because only Linear knows which already exist.
export async function runApplyDryRun(client: TaskRunner, slug: string, team: string): Promise<ApplyResult> {
  const run = await client.runTask(slug, [true, team]);
  if (run.status !== "completed" && run.status !== "succeeded") {
    throw new Error(`task ${slug} ended ${run.status}${run.error ? `: ${run.error}` : ""}`);
  }
  const result = run.results[0] as ApplyResult | undefined;
  if (!result || result.dryRun !== true || !Array.isArray(result.applied) || !Array.isArray(result.skipped)) {
    throw new Error(`task ${slug} returned no dry run`);
  }
  if (result.skipped.length) {
    throw new Error(`the changeset does not apply as written:\n${result.skipped.map((o) => `- ${o.op} ${o.target}: ${o.why}`).join("\n")}`);
  }
  const created = result.applied.filter((o) => o.op === "release").map((o) => o.target);
  if (created.length > MAX_NEW_RELEASES) {
    throw new Error(`the changeset creates ${created.length} Releases (${created.join(", ")}); at most ${MAX_NEW_RELEASES} per calibration, so serve an open one`);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [which = "plan", team = "CIT", ...deliveries] = process.argv.slice(2);
  const client = createWorkflowsClient({ useLocalDev: true });
  const slug = `${process.env.CALIBRATION_TASK_PREFIX ?? ""}${which}`;
  const out =
    which === "apply"
      ? await runApplyDryRun(client, slug, team)
      : await runPlan(client, slug, team, deliveries.length ? deliveries : ["CIT-439"]);
  process.stdout.write(JSON.stringify(out) + "\n");
}
