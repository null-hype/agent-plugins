import { test } from "node:test";
import assert from "node:assert/strict";
import { openIssues } from "./linear.ts";

function node(id: string, over: Record<string, unknown> = {}) {
  return {
    identifier: id,
    title: id,
    state: { type: "backlog" },
    parent: null,
    inverseRelations: { nodes: [] },
    releases: { nodes: [] },
    ...over,
  };
}

function fakeLinear(pages: unknown[], calls: unknown[] = []) {
  return (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  }) as typeof fetch;
}

test("reads every page and keeps only open blockers, parents and releases", async () => {
  const calls: { variables: { team: string; after: string | null } }[] = [];
  const issues = await openIssues(
    "key",
    "CIT",
    fakeLinear(
      [
        {
          data: {
            issues: {
              pageInfo: { hasNextPage: true, endCursor: "c1" },
              nodes: [
                node("CIT-2", {
                  inverseRelations: {
                    nodes: [
                      { type: "blocks", issue: { identifier: "CIT-1", state: { type: "started" } } },
                      { type: "blocks", issue: { identifier: "CIT-0", state: { type: "completed" } } },
                      { type: "related", issue: { identifier: "CIT-5", state: { type: "backlog" } } },
                    ],
                  },
                  parent: { identifier: "CIT-400", state: { type: "completed" } },
                }),
              ],
            },
          },
        },
        {
          data: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: "c2" },
              nodes: [
                node("CIT-1", {
                  state: { type: "started" },
                  parent: { identifier: "CIT-439", state: { type: "unstarted" } },
                  releases: {
                    nodes: [
                      { name: "amazed-bluebird", completedAt: null, canceledAt: null },
                      { name: "old", completedAt: "2026-10-01T00:00:00Z", canceledAt: null },
                    ],
                  },
                }),
              ],
            },
          },
        },
      ],
      calls,
    ),
  );
  assert.deepEqual(calls.map((c) => c.variables), [
    { team: "CIT", after: null },
    { team: "CIT", after: "c1" },
  ]);
  assert.deepEqual(issues, [
    { id: "CIT-2", title: "CIT-2", stage: "backlog", blockedBy: ["CIT-1"], parent: undefined, releases: [] },
    { id: "CIT-1", title: "CIT-1", stage: "started", blockedBy: [], parent: "CIT-439", releases: ["amazed-bluebird"] },
  ]);
});

test("a failed read fails the plan rather than returning an empty graph", async () => {
  await assert.rejects(
    openIssues("key", "CIT", fakeLinear([{ errors: [{ message: "bad filter" }] }])),
    /Linear query failed/,
  );
});
