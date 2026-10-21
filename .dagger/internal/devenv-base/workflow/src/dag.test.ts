import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, type Issue } from "./dag.ts";

function issue(id: string, over: Partial<Issue> = {}): Issue {
  return { id, title: id, stage: "backlog", blockedBy: [], releases: [], ...over };
}

test("keeps only what reaches a release, in dependency order", () => {
  const p = plan([
    issue("CIT-3", { blockedBy: ["CIT-2"], releases: ["amazed-bluebird"] }),
    issue("CIT-2", { blockedBy: ["CIT-1"] }),
    issue("CIT-1", { stage: "unstarted" }),
    issue("CIT-9"),
  ]);
  assert.deepEqual(p.sinks, ["release:amazed-bluebird"]);
  assert.deepEqual(p.order.map((i) => i.id), ["CIT-1", "CIT-2", "CIT-3"]);
  assert.deepEqual(p.order.map((i) => i.status), ["ready", "waiting", "waiting"]);
  assert.deepEqual(p.pruned, ["CIT-9"]);
  assert.deepEqual(p.cycles, []);
});

test("a delivery issue is a sink until a release exists, and its sub-issues serve it", () => {
  const p = plan(
    [
      issue("CIT-439", { blockedBy: ["CIT-465"] }),
      issue("CIT-465"),
      issue("CIT-462", { stage: "triage", parent: "CIT-446" }),
      issue("CIT-446", { parent: "CIT-439" }),
      issue("CIT-131"),
    ],
    ["CIT-439"],
  );
  assert.deepEqual(p.sinks, ["CIT-439"]);
  assert.deepEqual(p.pruned, ["CIT-131"]);
  const triage = p.order.find((i) => i.id === "CIT-462")!;
  assert.equal(triage.status, "triage", "a Triage issue waits for planning to accept it");
  assert.deepEqual(triage.serves, ["CIT-439"]);
  // A parent link says what an issue serves, not what it waits for.
  assert.equal(p.order.find((i) => i.id === "CIT-446")!.status, "ready");
  assert.ok(
    p.order.findIndex((i) => i.id === "CIT-465") < p.order.findIndex((i) => i.id === "CIT-439"),
    "a blocker comes before what it blocks",
  );
});

test("a delivery that is not open is no sink", () => {
  const p = plan([issue("CIT-1")], ["CIT-439"]);
  assert.deepEqual(p.sinks, []);
  assert.deepEqual(p.pruned, ["CIT-1"]);
});

test("a blocks cycle is escalated, not ordered", () => {
  const p = plan([
    issue("CIT-1", { blockedBy: ["CIT-2"], releases: ["r"] }),
    issue("CIT-2", { blockedBy: ["CIT-1"] }),
    issue("CIT-3", { blockedBy: ["CIT-1"], releases: ["r"] }),
    issue("CIT-4", { releases: ["r"] }),
  ]);
  assert.deepEqual(p.order.map((i) => i.id), ["CIT-4"]);
  assert.deepEqual(p.cycles.sort(), ["CIT-1", "CIT-2", "CIT-3"]);
});

test("an issue serving two releases says so", () => {
  const p = plan([issue("CIT-1", { releases: ["b", "a"] })]);
  assert.deepEqual(p.order[0].serves, ["release:a", "release:b"]);
});

test("the same state gives the same plan", () => {
  const issues = [
    issue("CIT-2", { releases: ["r"] }),
    issue("CIT-1", { releases: ["r"] }),
  ];
  assert.deepEqual(plan(issues), plan(issues));
  assert.deepEqual(plan(issues).order.map((i) => i.id), ["CIT-2", "CIT-1"]);
});

test("the plan records when every open issue last changed, pruned ones included", () => {
  const p = plan(
    [issue("CIT-1", { stage: "triage", updatedAt: "t1" }), issue("CIT-2", { updatedAt: "t2", parent: "CIT-439" }), issue("CIT-439")],
    ["CIT-439"],
  );
  assert.deepEqual(p.pruned, ["CIT-1"]);
  assert.deepEqual(p.seen, { "CIT-1": "t1", "CIT-2": "t2" });
});
