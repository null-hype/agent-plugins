// Calibration's client (CIT-472): runs the `plan` task on the local task
// server that `render workflows dev` started, and prints the plan as JSON on
// stdout for supervisor.sh to commit. The SDK targets the dev server when
// RENDER_USE_LOCAL_DEV is set, so this never reaches api.render.com: there is
// nothing here that could deploy or run a task on Render itself.
//
// Usage: node dist/calibrate.js [task slug] [team] [delivery...]
import { createWorkflowsClient } from "@renderinc/sdk/workflows";
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [slug = "plan", team = "CIT", ...deliveries] = process.argv.slice(2);
  const client = createWorkflowsClient({ useLocalDev: true });
  const plan = await runPlan(client, slug, team, deliveries.length ? deliveries : ["CIT-439"]);
  process.stdout.write(JSON.stringify(plan) + "\n");
}
