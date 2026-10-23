import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initiativeContext, BOOTSTRAP_INITIATIVES, sourceRevision, MAX_CONTEXT_BYTES } from "./initiatives.ts";

const id = BOOTSTRAP_INITIATIVES[0];
const update = JSON.parse(await readFile(new URL("./fixtures/initiative-zero-update.json", import.meta.url), "utf8"));
const info = { id, name: "Initiative Zero", url: "https://linear.app/example/initiative/zero", updatedAt: "2026-10-22T23:50:51.584Z", description: "Bring Duo into use", content: "Maintainer direction" };
const page = (nodes: unknown[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!next, endCursor: next } });
function api(pages: unknown[], sent: { query: string; variables: unknown }[] = []): typeof fetch {
  return (async (_url, req) => {
    sent.push(JSON.parse(req!.body as string));
    return new Response(JSON.stringify(pages.shift()));
  }) as typeof fetch;
}

test("reads initiative description, all project/update pages and the actual traceable retro", async () => {
  const sent: { query: string; variables: unknown }[] = [];
  const contexts = await initiativeContext("credential", [id], api([
    { data: { initiative: { ...info, projects: page([{ id: "p1", name: "Duo", url: "https://linear.app/p1" }], "projects2") } } },
    { data: { initiative: { ...info, projects: page([{ id: "p2", name: "Native", url: "https://linear.app/p2" }]) } } },
    { data: { initiative: { id, initiativeUpdates: page([update], "updates2") } } },
    { data: { initiative: { id, initiativeUpdates: page([{ ...update, id: "other-update", body: "Other direction" }]) } } },
  ], sent));
  assert.deepEqual(sent.map((s) => s.variables), [{ id, after: null }, { id, after: "projects2" }, { id, after: null }, { id, after: "updates2" }]);
  assert(sent.every((s) => s.query.startsWith("query ") && !s.query.includes("mutation")));
  assert.equal(contexts[0].projects.length, 2);
  assert.equal(contexts[0].sources.find((s) => s.kind === "description")!.body, "Initiative Zero\n\nBring Duo into use\n\nMaintainer direction");
  const received = contexts[0].sources.find((s) => s.id === update.id)!;
  assert.equal(received.body, update.body);
  assert.equal(received.revision, sourceRevision(update.body, update.updatedAt));
  assert.notEqual(sourceRevision(update.body + "\nEdited", update.updatedAt), received.revision, "edits remain detectable even with the same timestamp");
});

test("read errors, absent credentials' access, incomplete pages and context overflow fail closed", async () => {
  for (const result of [{ errors: [{ message: "permission denied" }] }, { data: { initiative: null } }]) {
    await assert.rejects(initiativeContext("key", [id], api([result])), /initiative read failed/);
  }
  await assert.rejects(initiativeContext("key", [id], api([
    { data: { initiative: { ...info, projects: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } } },
  ])), /pagination did not advance/);
  await assert.rejects(initiativeContext("key", [id], api([
    { data: { initiative: { ...info, projects: page([]) } } },
    { data: { initiative: { id, initiativeUpdates: page([{ ...update, body: "x".repeat(MAX_CONTEXT_BYTES) }]) } } },
  ])), /context exceeds/);
  await assert.rejects(initiativeContext("key", [], api([])), /explicit initiative UUIDs/);
});

test("a repeated cursor or duplicate update never silently drops part of a page", async () => {
  await assert.rejects(initiativeContext("key", [id], api([
    { data: { initiative: { ...info, projects: page([]) } } },
    { data: { initiative: { id, initiativeUpdates: page([update], "again") } } },
    { data: { initiative: { id, initiativeUpdates: page([], "again") } } },
  ])), /pagination did not advance/);
  await assert.rejects(initiativeContext("key", [id], api([
    { data: { initiative: { ...info, projects: page([]) } } },
    { data: { initiative: { id, initiativeUpdates: page([update, update]) } } },
  ])), /duplicate initiative source/);
});
