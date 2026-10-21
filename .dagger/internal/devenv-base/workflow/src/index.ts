// The supervisor's Render Workflow (CIT-472). This first slice registers one
// read-only task, `plan`: it reads the open issues from Linear and returns
// the DAG built back from what gets published. Calibration runs it on the
// local task server (`render workflows dev -- npm start`); the tasks that act
// on the plan come in later slices.
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { plan as buildPlan, type Plan } from "./dag.ts";
import { openIssues } from "./linear.ts";

task(
  { name: "plan", retry: { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 } },
  async function plan(_ctx: TaskContext, team: string = "CIT", deliveries: string[] = ["CIT-439"]): Promise<Plan> {
    const key = process.env.LINEAR_API_KEY;
    if (!key) throw new Error("LINEAR_API_KEY must be set");
    return buildPlan(await openIssues(key, team), deliveries);
  },
);
