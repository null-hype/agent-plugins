import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlan, type TaskRunner } from "./calibrate.ts";

const plan = { sinks: ["CIT-439"], order: [], pruned: [], cycles: [] };

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
