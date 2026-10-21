// A real apply against live Linear (CIT-472), outside Render: the changeset
// given is dry-run, applied, then applied again, and the second apply must
// change nothing. It writes to Linear, so it runs only on purpose, from the
// ApplySmoke Dagger function.
//
// Usage: node dist/smoke.js <changeset.json> [team]
import { readFile } from "node:fs/promises";
import { apply, type ApplyResult } from "./apply.ts";
import type { Changeset } from "./changeset.ts";
import { linearClient } from "./linear.ts";

const [path, team = "CIT"] = process.argv.slice(2);
const key = process.env.LINEAR_API_KEY;
if (!path || !key) throw new Error("usage: LINEAR_API_KEY=... node dist/smoke.js <changeset.json> [team]");

const cs = JSON.parse(await readFile(path, "utf8")) as Changeset;
const linear = linearClient(key, team);
// Planning's snapshot, taken now: the smoke tests apply's writes, not drift.
for (const id of Object.keys(cs.seen)) {
  const issue = await linear.issue(id);
  if (!issue) throw new Error(`${id} does not exist`);
  cs.seen[id] = issue.updatedAt;
}

const show = (label: string, r: ApplyResult) => {
  console.log(`== ${label}`);
  for (const o of r.applied) console.log(`applied ${o.op} ${o.target}: ${o.detail}`);
  for (const o of r.skipped) console.log(`SKIPPED ${o.op} ${o.target}: ${o.why}`);
  console.log(`clusters ${JSON.stringify(r.clusters)}`);
  if (r.skipped.length) throw new Error(`${label} skipped ${r.skipped.length} op(s)`);
};

const dry = await apply(cs, linear, { dryRun: true });
show("dry run", dry);
const first = await apply(cs, linear, { dryRun: false });
show("apply", first);
if (first.applied.length !== dry.applied.length) {
  throw new Error(`apply did ${first.applied.length} op(s), the dry run promised ${dry.applied.length}`);
}
const second = await apply(cs, linear, { dryRun: false });
show("apply again", second);
if (second.applied.length) throw new Error("the second apply changed Linear: apply is not idempotent");

// What Linear says now, read fresh.
for (const id of [...new Set([...Object.values(first.clusters), ...cs.clusters.flatMap((c) => c.issues)])]) {
  const i = await linear.issue(id);
  console.log(`linear ${id}: ${JSON.stringify(i)}`);
}
console.log("SMOKE: ok");
