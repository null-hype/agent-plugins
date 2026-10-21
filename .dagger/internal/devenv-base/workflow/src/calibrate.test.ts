import { test } from "node:test";
import assert from "node:assert/strict";
import { runApplyDryRun, runPlan, type TaskRunner } from "./calibrate.ts";

const plan = { sinks: ["CIT-439"], order: [], pruned: [], cycles: [], seen: {} };

function runner(run: Awaited<ReturnType<TaskRunner["runTask"]>>, calls: unknown[][] = []): TaskRunner {
  return {
    async runTask(slug, input) {
      calls.push([slug, input]);
      return run;
    },
  };
}

test("runs the plan task with the team and deliveries and returns its plan", async () => {
  const calls: unknown[][] = [];
  const got = await runPlan(runner({ status: "completed", results: [plan] }, calls), "plan", "CIT", ["CIT-439"]);
  assert.deepEqual(got, plan);
  assert.deepEqual(calls, [["plan", ["CIT", ["CIT-439"]]]]);
});

test("a failed run is a failed calibration, with the task's error", async () => {
  await assert.rejects(
    runPlan(runner({ status: "failed", results: [], error: "LINEAR_API_KEY must be set" }), "plan", "CIT", []),
    /task plan ended failed: LINEAR_API_KEY must be set/,
  );
});

test("a completed run without a plan is not read as an empty plan", async () => {
  await assert.rejects(runPlan(runner({ status: "completed", results: [] }), "plan", "CIT", []), /returned no plan/);
  await assert.rejects(runPlan(runner({ status: "completed", results: [{ order: [] }] }), "plan", "CIT", []), /returned no plan/);
});

test("the apply dry run is always asked for with dryRun true", async () => {
  const calls: unknown[][] = [];
  const result = { dryRun: true, applied: [], skipped: [], clusters: {} };
  assert.deepEqual(await runApplyDryRun(runner({ status: "completed", results: [result] }, calls), "apply", "CIT"), result);
  assert.deepEqual(calls, [["apply", [true, "CIT"]]]);
});

test("a dry run that skipped an op, or was not a dry run, fails the calibration", async () => {
  await assert.rejects(
    runApplyDryRun(
      runner({ status: "completed", results: [{ dryRun: true, applied: [], skipped: [{ op: "parent", target: "CIT-501", detail: "", why: "CIT-501 changed since planning" }], clusters: {} }] }),
      "apply",
      "CIT",
    ),
    /does not apply as written:\n- parent CIT-501: CIT-501 changed since planning/,
  );
  await assert.rejects(
    runApplyDryRun(runner({ status: "completed", results: [{ dryRun: false, applied: [], skipped: [], clusters: {} }] }), "apply", "CIT"),
    /returned no dry run/,
  );
});
