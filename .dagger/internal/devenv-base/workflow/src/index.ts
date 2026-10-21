// The supervisor's Render Workflow (CIT-472). Two tasks so far, both of
// which calibration runs on the local task server (`render workflows dev --
// npm start`) before anything is merged:
//
// - `plan` reads the open issues from Linear and returns the DAG built back
//   from what gets published. Read-only.
// - `apply` makes Linear match the committed changeset.json, which planning
//   wrote and the maintainer merged. Merging is applying: the deployed
//   workflow converges Linear to main. Calibration runs it with dryRun, its
//   test; it writes only when called with dryRun false.
import { readFile } from "node:fs/promises";
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { apply as applyChangeset, type ApplyResult } from "./apply.ts";
import type { Changeset } from "./changeset.ts";
import { plan as buildPlan, type Plan } from "./dag.ts";
import { linearClient, openIssues } from "./linear.ts";

const linearKey = () => {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error("LINEAR_API_KEY must be set");
  return key;
};

task(
  { name: "plan", retry: { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 } },
  async function plan(_ctx: TaskContext, team: string = "CIT", deliveries: string[] = ["CIT-439"]): Promise<Plan> {
    return buildPlan(await openIssues(linearKey(), team), deliveries);
  },
);

// No retries: apply is idempotent, but a run that failed halfway should be
// looked at before it is run again, not repeated blind.
task(
  { name: "apply" },
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
    const cs = JSON.parse(await readFile(new URL(`../${changeset}`, import.meta.url), "utf8")) as Changeset;
    return applyChangeset(cs, linearClient(linearKey(), team), { dryRun });
  },
);
