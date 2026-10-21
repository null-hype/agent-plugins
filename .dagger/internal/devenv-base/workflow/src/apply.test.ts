import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, marker, type LinearClient, type LinearIssue } from "./apply.ts";
import { validate, type Changeset } from "./changeset.ts";

const T0 = "2026-10-21T00:00:00Z";

// Linear in memory. Every write is logged, so a dry run can be checked for
// making none, and every write bumps updatedAt, the way Linear does.
function fakeLinear(issues: Partial<LinearIssue>[], existing: { pipelines?: string[]; releases?: string[] } = {}) {
  const pipelines = new Set(existing.pipelines ?? []);
  const releases = new Set(existing.releases ?? []);
  const store = new Map<string, LinearIssue & { description: string }>();
  for (const i of issues) {
    store.set(i.identifier!, { updatedAt: T0, stage: "triage", labels: [], blockedBy: [], releases: [], description: "", ...i } as LinearIssue & { description: string });
  }
  const writes: string[] = [];
  let next = 900;
  let clock = 0;
  const touch = (id: string) => {
    store.get(id)!.updatedAt = `2026-10-21T01:00:${String(++clock).padStart(2, "0")}Z`;
  };
  const client: LinearClient = {
    async issue(id) {
      const i = store.get(id);
      return i ? structuredClone(i) : null;
    },
    async findByMarker(m) {
      return [...store.values()].find((i) => i.description.includes(m)) ?? null;
    },
    async createIssue({ title, description, parent }) {
      const identifier = `CIT-${next++}`;
      writes.push(`create ${identifier} ${title} under ${parent}`);
      const i = { identifier, updatedAt: T0, stage: "unstarted", parent, labels: [], blockedBy: [], releases: [], description };
      store.set(identifier, i);
      return structuredClone(i);
    },
    async setParent(id, parent) {
      writes.push(`parent ${id} ${parent}`);
      const i = store.get(id)!;
      i.parent = parent;
      if (i.stage === "triage") i.stage = "unstarted";
      touch(id);
    },
    async addBlocks(blocker, blocked) {
      writes.push(`blocks ${blocker} ${blocked}`);
      store.get(blocked)!.blockedBy.push(blocker);
    },
    async cancel(id) {
      writes.push(`cancel ${id}`);
      store.get(id)!.stage = "canceled";
      touch(id);
    },
    async markDuplicate(id, of) {
      writes.push(`duplicate ${id} ${of}`);
      store.get(id)!.stage = "canceled";
      touch(id);
    },
    async addLabel(id, label) {
      writes.push(`label ${id} ${label}`);
      store.get(id)!.labels.push(label);
      touch(id);
    },
    async comment(id, body) {
      writes.push(`comment ${id} ${body}`);
      touch(id);
    },
    async delegate(id, agent) {
      writes.push(`delegate ${id} ${agent}`);
      store.get(id)!.delegate = agent;
      touch(id);
    },
    async hasPipeline(name) {
      return pipelines.has(name);
    },
    async createPipeline(name) {
      writes.push(`pipeline ${name}`);
      pipelines.add(name);
    },
    async hasRelease(name) {
      return releases.has(name);
    },
    async createRelease({ name, pipeline }) {
      assert.ok(pipelines.has(pipeline), `release ${name} created before its pipeline ${pipeline}`);
      writes.push(`release ${name} in ${pipeline}`);
      releases.add(name);
    },
    async addToRelease(id, release) {
      assert.ok(releases.has(release), `${id} added to release ${release} before it exists`);
      writes.push(`attach ${id} ${release}`);
      store.get(id)!.releases.push(release);
      touch(id);
    },
  };
  return { client, store, writes };
}

const world = () =>
  fakeLinear([
    { identifier: "CIT-439", stage: "started" },
    { identifier: "CIT-465", stage: "backlog", parent: "CIT-439" },
    { identifier: "CIT-500" },
    { identifier: "CIT-501" },
    { identifier: "CIT-502" },
    { identifier: "CIT-503" },
    { identifier: "CIT-504" },
  ]);

const changeset = (): Changeset => ({
  seen: { "CIT-465": T0, "CIT-500": T0, "CIT-501": T0, "CIT-502": T0, "CIT-503": T0, "CIT-504": T0 },
  releases: [],
  clusters: [
    {
      key: "new:review-findings",
      title: "Review findings on the supervisor",
      description: "The Codex findings on #242 and #243.",
      hat: "infra",
      model: "sonnet",
      effort: "high",
      serves: "CIT-439",
      blockedBy: ["CIT-465"],
      issues: ["CIT-500", "CIT-501"],
    },
  ],
  decline: [{ issue: "CIT-502", reason: "nothing published depends on it" }],
  duplicate: [{ issue: "CIT-503", of: "CIT-500" }],
  escalate: [{ issue: "CIT-504", question: "is this a product decision?" }],
  delegate: [
    { issue: "new:review-findings", agent: "tidelands-agent" },
    { issue: "CIT-500", agent: "tidelands-agent" },
  ],
});

test("a dry run reads Linear, decides every op, and writes nothing", async () => {
  const { client, writes } = world();
  const r = await apply(changeset(), client, { dryRun: true });
  assert.deepEqual(writes, []);
  assert.equal(r.dryRun, true);
  assert.deepEqual(
    r.applied.map((o) => `${o.op} ${o.target}`),
    [
      "create new:review-findings",
      "parent CIT-500",
      "parent CIT-501",
      "blocks new:review-findings",
      "decline CIT-502",
      "duplicate CIT-503",
      "escalate CIT-504",
      "delegate new:review-findings",
      "delegate CIT-500",
    ],
  );
  assert.deepEqual(r.skipped, []);
});

test("apply makes Linear match the changeset, and a second apply changes nothing", async () => {
  const { client, store, writes } = world();
  const first = await apply(changeset(), client, { dryRun: false });
  const parent = first.clusters["new:review-findings"];
  assert.equal(parent, "CIT-900");
  assert.equal(store.get(parent)!.parent, "CIT-439");
  assert.ok(store.get(parent)!.description.includes(marker("new:review-findings")));
  for (const id of ["CIT-500", "CIT-501"]) {
    assert.equal(store.get(id)!.parent, parent);
    assert.equal(store.get(id)!.stage, "unstarted", `${id} should be out of Triage`);
  }
  assert.deepEqual(store.get(parent)!.blockedBy, ["CIT-465"]);
  assert.equal(store.get("CIT-502")!.stage, "canceled");
  assert.equal(store.get("CIT-503")!.stage, "canceled");
  assert.deepEqual(store.get("CIT-504")!.labels, ["needs-maintainer"]);
  assert.equal(store.get(parent)!.delegate, "tidelands-agent");
  assert.equal(store.get("CIT-500")!.delegate, "tidelands-agent", "an issue parented in the same run is still delegated");

  // The issues it touched have moved on since planning; that is its own
  // doing, and every op is already satisfied, so nothing is skipped either.
  const count = writes.length;
  const second = await apply(changeset(), client, { dryRun: false });
  assert.equal(writes.length, count, `a second apply wrote: ${writes.slice(count).join("; ")}`);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, []);
  assert.equal(second.clusters["new:review-findings"], parent);
});

test("an issue changed since planning is left alone, and the rest is applied", async () => {
  const { client, store, writes } = world();
  store.get("CIT-501")!.updatedAt = "2026-10-21T05:00:00Z";
  const r = await apply(changeset(), client, { dryRun: false });
  assert.deepEqual(r.skipped.map((o) => `${o.op} ${o.target}: ${o.why}`), ["parent CIT-501: CIT-501 changed since planning"]);
  assert.equal(store.get("CIT-501")!.stage, "triage");
  assert.ok(writes.includes("parent CIT-500 CIT-900"));
});

test("an issue that is gone is skipped, not created", async () => {
  const { client, store } = world();
  store.delete("CIT-504");
  const r = await apply(changeset(), client, { dryRun: true });
  assert.deepEqual(r.skipped.map((o) => o.why), ["CIT-504 does not exist"]);
});

test("an existing issue can be the cluster's parent", async () => {
  const { client, store } = world();
  const cs = changeset();
  cs.clusters[0] = { ...cs.clusters[0], key: "CIT-465", blockedBy: [] };
  cs.delegate = [{ issue: "CIT-465", agent: "tidelands-agent" }];
  const r = await apply(cs, client, { dryRun: false });
  assert.equal(r.clusters["CIT-465"], "CIT-465");
  assert.equal(store.get("CIT-500")!.parent, "CIT-465");
  assert.ok(!r.applied.some((o) => o.op === "create"));
  assert.equal(store.get("CIT-465")!.delegate, "tidelands-agent");
});

// The theme planning would otherwise decline for want of a sink: it gets a
// Release of its own.
const withRelease = (): Changeset => {
  const cs = changeset();
  cs.releases = [{ name: "supervisor-workflow", description: "The supervisor as a Render Workflow.", pipeline: "agent-plugins" }];
  cs.clusters[0] = { ...cs.clusters[0], serves: "release:supervisor-workflow" };
  return cs;
};

test("a cluster can serve a Release the changeset creates, pipeline and all", async () => {
  const { client, store, writes } = world();
  const dry = await apply(withRelease(), client, { dryRun: true });
  assert.deepEqual(writes, []);
  assert.deepEqual(
    dry.applied.slice(0, 3).map((o) => `${o.op} ${o.target}: ${o.detail}`),
    [
      "pipeline agent-plugins: a new release pipeline",
      "release supervisor-workflow: in agent-plugins: The supervisor as a Render Workflow.",
      'create new:review-findings: "Review findings on the supervisor" in release supervisor-workflow (infra, sonnet, high)',
    ],
  );

  const first = await apply(withRelease(), client, { dryRun: false });
  assert.deepEqual(first.skipped, []);
  const parent = first.clusters["new:review-findings"];
  assert.equal(store.get(parent)!.parent, undefined, "a cluster serving a Release has no parent issue");
  assert.deepEqual(store.get(parent)!.releases, ["supervisor-workflow"]);
  assert.equal(store.get("CIT-500")!.parent, parent);

  const count = writes.length;
  const second = await apply(withRelease(), client, { dryRun: false });
  assert.equal(writes.length, count, `a second apply wrote: ${writes.slice(count).join("; ")}`);
  assert.deepEqual(second.applied, []);
});

test("a Release that already exists is used, and an existing cluster parent is added to it", async () => {
  const { client, store, writes } = fakeLinear(
    [
      { identifier: "CIT-465", stage: "backlog" },
      { identifier: "CIT-500" },
      { identifier: "CIT-501" },
      { identifier: "CIT-502" },
      { identifier: "CIT-503" },
      { identifier: "CIT-504" },
    ],
    { pipelines: ["agent-plugins"], releases: ["supervisor-workflow"] },
  );
  const cs = withRelease();
  cs.clusters[0] = { ...cs.clusters[0], key: "CIT-465", blockedBy: [] };
  cs.delegate = [];
  const r = await apply(cs, client, { dryRun: false });
  assert.ok(!r.applied.some((o) => o.op === "pipeline" || o.op === "release"));
  assert.deepEqual(r.applied[0], { op: "attach", target: "CIT-465", detail: "in release supervisor-workflow (infra, sonnet, high)" });
  assert.deepEqual(store.get("CIT-465")!.releases, ["supervisor-workflow"]);
  assert.ok(!writes.some((w) => w.startsWith("pipeline") || w.startsWith("release")));
});

test("an invalid changeset is refused before anything is read or written", async () => {
  const { client, writes } = world();
  const cs = changeset();
  cs.decline.push({ issue: "CIT-500", reason: "again" });
  await assert.rejects(apply(cs, client, { dryRun: false }), /CIT-500 is in both cluster new:review-findings and decline/);
  assert.deepEqual(writes, []);
});

test("validate names every problem", () => {
  const cs = changeset();
  cs.clusters.push({ ...cs.clusters[0], key: "Review Findings", hat: "planning" as never, model: "gpt" as never, issues: [] });
  cs.escalate.push({ issue: "CIT-999", question: "" });
  cs.delegate.push({ issue: "CIT-502", agent: "tidelands-agent" }, { issue: "new:nothing", agent: "" });
  assert.deepEqual(validate(cs), [
    "cluster Review Findings: the key must be new:<slug> or an issue identifier",
    "cluster Review Findings: hat planning is not infra or open-source",
    "cluster Review Findings: model gpt is not one of haiku, sonnet, opus",
    "cluster Review Findings has no issues",
    "escalate: CIT-999 was not seen by planning",
    "escalate CIT-999 has no question",
    "delegate CIT-502 is also in decline",
    "delegate new:nothing is neither a cluster nor an issue planning saw",
    "delegate new:nothing names no agent",
  ]);
});

test("validate holds a cluster's Release to the changeset's releases", () => {
  const cs = withRelease();
  cs.releases.push({ name: "nobody-serves-this", description: "", pipeline: "" }, { ...cs.releases[0] });
  cs.clusters.push({ ...cs.clusters[0], key: "new:other", serves: "release:not-declared", blockedBy: [], issues: ["CIT-504"] });
  cs.escalate = [];
  assert.deepEqual(validate(cs), [
    "release nobody-serves-this names no pipeline",
    "release supervisor-workflow appears twice",
    "cluster new:other: serves release:not-declared, which is not in releases",
    "release nobody-serves-this is served by no cluster",
  ]);
});
