// A real apply against live Linear (CIT-472), through the workflow's own
// `apply` task on the local task server that `render workflows dev` started,
// the way the deployed workflow will run it. The changeset given is dry-run,
// applied, then applied again, and the second apply must change nothing. It
// writes to Linear, so it runs only on purpose, from the ApplySmoke Dagger
// function.
//
// Usage: node dist/smoke.js <changeset.json> [team]
// The path is relative to the workflow's package root, like the task's own
// `changeset` argument.
import { readFile, writeFile } from "node:fs/promises";
import { createWorkflowsClient } from "@renderinc/sdk/workflows";
import type { ApplyResult } from "./apply.ts";
import type { Changeset } from "./changeset.ts";
import { linearClient } from "./linear.ts";

const [path, team = "CIT"] = process.argv.slice(2);
const key = process.env.LINEAR_API_KEY;
if (!path || !key) throw new Error("usage: LINEAR_API_KEY=... node dist/smoke.js <changeset.json> [team]");

// Planning's snapshot, taken now: the smoke tests apply's writes, not drift.
// The refreshed copy is what the task reads.
const cs = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")) as Changeset;
const linear = linearClient(key, team);
for (const id of Object.keys(cs.seen)) {
  const issue = await linear.issue(id);
  if (!issue) throw new Error(`${id} does not exist`);
  cs.seen[id] = issue.updatedAt;
}
const run = path.replace(/\.json$/, ".run.json");
await writeFile(new URL(`../${run}`, import.meta.url), JSON.stringify(cs));

// The standing test pipeline (Richard, 2026-10-21): smoke Releases live in
// `agent-plugins`, never in the planning pipeline. The first smoke run made it
// continuous and production, where a Release is born completed; it is set to
// scheduled and non-production here, once, before apply uses it.
const TEST_PIPELINE = "agent-plugins";
const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || body.errors || !body.data) throw new Error(`Linear request failed: ${JSON.stringify(body.errors ?? body)}`);
  return body.data;
};
if (cs.releases.some((r) => r.pipeline === TEST_PIPELINE)) {
  const { releasePipelines } = await gql<{ releasePipelines: { nodes: { id: string; type: string; isProduction: boolean }[] } }>(
    `query($name: String!) { releasePipelines(filter: { name: { eq: $name } }) { nodes { id type isProduction } } }`,
    { name: TEST_PIPELINE },
  );
  const p = releasePipelines.nodes[0];
  if (p && (p.type !== "scheduled" || p.isProduction)) {
    await gql(`mutation($id: String!, $input: ReleasePipelineUpdateInput!) { releasePipelineUpdate(id: $id, input: $input) { success } }`, {
      id: p.id,
      input: { type: "scheduled", isProduction: false },
    });
    console.log(`test pipeline ${TEST_PIPELINE}: was ${p.type}${p.isProduction ? ", production" : ""}; now scheduled, not production`);
  }
}

const client = createWorkflowsClient({ useLocalDev: true });
const slug = `${process.env.CALIBRATION_TASK_PREFIX ?? ""}apply`;
const applyTask = async (label: string, dryRun: boolean): Promise<ApplyResult> => {
  const r = await client.runTask(slug, [dryRun, team, run]);
  if (r.status !== "completed" && r.status !== "succeeded") {
    throw new Error(`${label}: task ${slug} ended ${r.status}${r.error ? `: ${r.error}` : ""}`);
  }
  const result = r.results[0] as ApplyResult;
  console.log(`== ${label} (task ${slug}, dryRun ${result.dryRun})`);
  for (const o of result.applied) console.log(`applied ${o.op} ${o.target}: ${o.detail}`);
  for (const o of result.skipped) console.log(`SKIPPED ${o.op} ${o.target}: ${o.why}`);
  console.log(`clusters ${JSON.stringify(result.clusters)}`);
  if (result.dryRun !== dryRun) throw new Error(`${label}: asked for dryRun ${dryRun}, got ${result.dryRun}`);
  if (result.skipped.length) throw new Error(`${label} skipped ${result.skipped.length} op(s)`);
  return result;
};

const dry = await applyTask("dry run", true);
const first = await applyTask("apply", false);
if (first.applied.length !== dry.applied.length) {
  throw new Error(`apply did ${first.applied.length} op(s), the dry run promised ${dry.applied.length}`);
}
const second = await applyTask("apply again", false);
if (second.applied.length) throw new Error("the second apply changed Linear: apply is not idempotent");

// What Linear says now, read fresh.
for (const id of [...new Set([...Object.values(first.clusters), ...cs.clusters.flatMap((c) => c.issues)])]) {
  console.log(`linear ${id}: ${JSON.stringify(await linear.issue(id))}`);
}
console.log("SMOKE: ok");
