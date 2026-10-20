import { test } from "node:test";
import assert from "node:assert/strict";
import type { LinearClient } from "@linear/sdk";
import { editedEnvironment, handOff, shipRequest, shipTarget } from "./handoff.ts";

// How codex_review writes a finding's description.
const FINDING = "At `hk/codex-review-sync.sh:45`, ...\n\nPR: [https://github.com/null-hype/agent-plugins/pull/235](<https://github.com/null-hype/agent-plugins/pull/235>)\nEnvironment: fluent-marten";

const lookup235 = async (repo: string, pr: number) => {
  assert.deepEqual([repo, pr], ["null-hype/agent-plugins", 235]);
  return { head: "cit-445-fix", base: "cit-432-fix" };
};

test("editedEnvironment counts edits only", () => {
  assert.equal(editedEnvironment("mcp__container-use__environment_file_edit", { environment_id: "coherent-salmon" }), "coherent-salmon");
  assert.equal(editedEnvironment("mcp__container-use__environment_file_read", { environment_id: "coherent-salmon" }), undefined);
  assert.equal(editedEnvironment("mcp__container-use__environment_file_write", {}), undefined);
});

test("shipTarget sends a finding's fix to the PR it reviewed", async () => {
  assert.deepEqual(await shipTarget(FINDING, "cit-447-finding", lookup235), { branch: "cit-445-fix", base: "cit-432-fix", pr: 235 });
});

test("shipTarget sends other issues to their own branch, into main", async () => {
  const unreachable = async () => assert.fail("no PR to look up");
  assert.deepEqual(await shipTarget("Build the left page.", "cit-446-left-page", unreachable), { branch: "cit-446-left-page", base: "main" });
  assert.deepEqual(await shipTarget(undefined, "cit-446-left-page", unreachable), { branch: "cit-446-left-page", base: "main" });
});

test("shipRequest reviews the existing PR, or the one the ship opens", () => {
  const existing = shipRequest("CIT-447", "Fix it", "coherent-salmon", { branch: "cit-445-fix", base: "cit-432-fix", pr: 235 });
  assert.match(existing, /^@linear /);
  assert.match(existing, /`agent_ship` with env `coherent-salmon`, branch `cit-445-fix`, base `cit-432-fix`, title `Fix it \(CIT-447\)`/);
  assert.match(existing, /`codex_review` on PR 235,/);
  assert.match(shipRequest("CIT-446", "Page", "e", { branch: "b", base: "main" }), /`codex_review` on the PR it opens,/);
});

function fakeLinear(calls: unknown[], description: string, stateNodes = [{ id: "in-review" }]): LinearClient {
  return {
    issue: async () => ({
      identifier: "CIT-447",
      title: "Fix it",
      description,
      branchName: "cit-447-finding",
      team: Promise.resolve({ states: async () => ({ nodes: stateNodes }) }),
    }),
    updateIssue: async (id: string, input: unknown) => void calls.push(["updateIssue", id, input]),
    createComment: async (input: { body: string }) => void calls.push(["createComment", input.body.split("\n")[0]]),
  } as unknown as LinearClient;
}

test("handOff moves the issue to In Review and posts the ship request", async () => {
  const calls: unknown[] = [];
  const line = await handOff(fakeLinear(calls, FINDING), "issue-1", "coherent-salmon", lookup235);
  assert.deepEqual(calls, [
    ["updateIssue", "issue-1", { stateId: "in-review" }],
    ["createComment", "@linear please ship and review the Claude agent's work on this issue:"],
  ]);
  assert.match(line, /^Moved this issue to In Review/);
  assert.doesNotMatch(line, /@/);
});

test("handOff reports a failure instead of throwing", async () => {
  const calls: unknown[] = [];
  const failing = async () => {
    throw new Error("HTTP 404");
  };
  const line = await handOff(fakeLinear(calls, FINDING), "issue-1", "coherent-salmon", failing);
  assert.deepEqual(calls, []);
  assert.match(line, /^Couldn't hand `coherent-salmon` on for shipping: HTTP 404/);
});
