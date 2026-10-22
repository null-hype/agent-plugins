import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, askMarker, marker, reviewMarker, shipMarker, type LinearClient, type LinearIssue } from "./apply.ts";
import { validate, type Changeset } from "./changeset.ts";

const T0 = "2026-10-21T00:00:00Z";

// Linear in memory. Every write is logged, so a dry run can be checked for
// making none, and every write bumps updatedAt, the way Linear does.
// A host that is always ready and ships nothing: for the tests that are not
// about the host.
const idleHost = { wake: async () => {}, ship: async () => {}, review: async () => {} };

function fakeLinear(
  issues: Partial<LinearIssue>[],
  existing: { pipelines?: string[]; releases?: string[]; labels?: string[]; users?: string[] } = {},
) {
  const pipelines = new Set(existing.pipelines ?? []);
  const releases = new Set(existing.releases ?? []);
  const labels = new Set(existing.labels ?? []);
  const users = new Set(existing.users ?? ["tidelands-agent"]);
  const store = new Map<string, LinearIssue & { description: string }>();
  for (const i of issues) {
    store.set(i.identifier!, { updatedAt: T0, stage: "triage", labels: [], blockedBy: [], releases: [], description: "", branch: `branch-${i.identifier!.toLowerCase()}`, shipped: [], reviewed: [], ...i } as LinearIssue & { description: string });
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
      const i = { identifier, updatedAt: T0, stage: "unstarted", parent, labels: [], blockedBy: [], releases: [], description, branch: `branch-${identifier.toLowerCase()}`, shipped: [] as string[], reviewed: [] as number[] };
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
    async complete(id) {
      writes.push(`complete ${id}`);
      store.get(id)!.stage = "completed";
      touch(id);
    },
    async markDuplicate(id, of) {
      writes.push(`duplicate ${id} ${of}`);
      store.get(id)!.stage = "canceled";
      touch(id);
    },
    async addLabel(id, label) {
      assert.ok(labels.has(label), `${id} labelled ${label} before it exists`);
      writes.push(`label ${id} ${label}`);
      store.get(id)!.labels.push(label);
      touch(id);
    },
    async hasLabel(name) {
      return labels.has(name);
    },
    async createLabel(name) {
      writes.push(`new label ${name}`);
      labels.add(name);
    },
    async hasUser(name) {
      return users.has(name);
    },
    async comment(id, body) {
      writes.push(`comment ${id} ${body}`);
      for (const m of body.matchAll(/<!-- supervisor-ship ([a-z]+-[a-z]+) -->/g)) store.get(id)!.shipped.push(m[1]!);
      for (const m of body.matchAll(/<!-- supervisor-review ([0-9]+) -->/g)) store.get(id)!.reviewed.push(Number(m[1]));
      for (const m of body.matchAll(/<!-- supervisor-ask ([0-9a-f]{12}) -->/g)) {
        (store.get(id)!.asked ??= []).push(m[1]!);
        store.get(id)!.shipped = [];
      }
      touch(id);
    },
    async delegate(id, agent) {
      writes.push(`delegate ${id} ${agent}`);
      store.get(id)!.delegate = agent;
      touch(id);
    },
    async undelegate(id) {
      writes.push(`undelegate ${id}`);
      store.get(id)!.delegate = undefined;
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
      "label needs-maintainer",
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
  const first = await apply(changeset(), client, { dryRun: false, toolbox: idleHost });
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
  const second = await apply(changeset(), client, { dryRun: false, toolbox: idleHost });
  assert.equal(writes.length, count, `a second apply wrote: ${writes.slice(count).join("; ")}`);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped, []);
  assert.equal(second.clusters["new:review-findings"], parent);
});

test("a marker survives Linear's emoji shortcodes: it has no colons", () => {
  assert.equal(marker("new:review-findings"), "<!-- supervisor-changeset new/review-findings -->");
  assert.doesNotMatch(marker("new:new"), /:/);
});

test("an issue changed since planning is left alone, and the rest is applied", async () => {
  const { client, store, writes } = world();
  store.get("CIT-501")!.updatedAt = "2026-10-21T05:00:00Z";
  const r = await apply(changeset(), client, { dryRun: false, toolbox: idleHost });
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
  const r = await apply(cs, client, { dryRun: false, toolbox: idleHost });
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
    dry.applied.slice(0, 4).map((o) => `${o.op} ${o.target}: ${o.detail}`),
    [
      "pipeline agent-plugins: a new release pipeline",
      "release supervisor-workflow: in agent-plugins: The supervisor as a Render Workflow.",
      "label needs-maintainer: a new label for escalations",
      'create new:review-findings: "Review findings on the supervisor" in release supervisor-workflow (infra, sonnet, high)',
    ],
  );

  const first = await apply(withRelease(), client, { dryRun: false, toolbox: idleHost });
  assert.deepEqual(first.skipped, []);
  const parent = first.clusters["new:review-findings"];
  assert.equal(store.get(parent)!.parent, undefined, "a cluster serving a Release has no parent issue");
  assert.deepEqual(store.get(parent)!.releases, ["supervisor-workflow"]);
  assert.equal(store.get("CIT-500")!.parent, parent);

  const count = writes.length;
  const second = await apply(withRelease(), client, { dryRun: false, toolbox: idleHost });
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
    { pipelines: ["agent-plugins"], releases: ["supervisor-workflow"], labels: ["needs-maintainer"] },
  );
  const cs = withRelease();
  cs.clusters[0] = { ...cs.clusters[0], key: "CIT-465", blockedBy: [] };
  cs.delegate = [];
  const r = await apply(cs, client, { dryRun: false, toolbox: idleHost });
  assert.ok(!r.applied.some((o) => o.op === "pipeline" || o.op === "release"));
  assert.deepEqual(r.applied[0], { op: "attach", target: "CIT-465", detail: "in release supervisor-workflow (infra, sonnet, high)" });
  assert.deepEqual(store.get("CIT-465")!.releases, ["supervisor-workflow"]);
  assert.ok(!writes.some((w) => w.startsWith("pipeline") || w.startsWith("release")));
});

test("an invalid changeset is refused before anything is read or written", async () => {
  const { client, writes } = world();
  const cs = changeset();
  cs.decline.push({ issue: "CIT-500", reason: "again" });
  await assert.rejects(apply(cs, client, { dryRun: false, toolbox: idleHost }), /CIT-500 is in both cluster new:review-findings and decline/);
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

// The first real apply (#246) failed on its first escalation: the label did
// not exist, and the dry run had never asked.
test("a dry run asks for every label and agent a write would need", async () => {
  const { client } = fakeLinear(
    [{ identifier: "CIT-439", stage: "started" }, { identifier: "CIT-504" }, { identifier: "CIT-505" }],
    { labels: ["needs-maintainer"], users: [] },
  );
  const cs: Changeset = {
    ...changeset(),
    seen: { "CIT-504": T0, "CIT-505": T0 },
    clusters: [],
    decline: [],
    duplicate: [],
    escalate: [{ issue: "CIT-504", question: "is this a product decision?" }],
    delegate: [{ issue: "CIT-505", agent: "nobody" }],
  };
  const r = await apply(cs, client, { dryRun: true });
  assert.deepEqual(r.applied.map((o) => `${o.op} ${o.target}`), ["escalate CIT-504"], "an existing label is not created again");
  assert.deepEqual(r.skipped.map((o) => `${o.op} ${o.target}: ${o.why}`), ["delegate CIT-505: no Linear user or agent named nobody"]);
});

test("a write that fails halfway is not repeated on the rerun", async () => {
  const { client, writes } = world();
  let failed = false;
  const flaky = {
    ...client,
    async comment(id: string, body: string) {
      if (!failed) {
        failed = true;
        throw new Error("Linear is down");
      }
      return client.comment(id, body);
    },
  };
  await assert.rejects(apply(changeset(), flaky, { dryRun: false, toolbox: idleHost }), /Linear is down/);
  await apply(changeset(), flaky, { dryRun: false, toolbox: idleHost });
  assert.deepEqual(writes.filter((w) => w.startsWith("cancel CIT-502")), ["cancel CIT-502"]);
  assert.deepEqual(writes.filter((w) => w.startsWith("comment CIT-502")), [], "the rerun sees CIT-502 canceled and leaves it");
});

// A host that records what was asked of it.
const recordingHost = () => {
  const calls: string[] = [];
  return { calls, wake: async () => void calls.push("wake"), ship: async (env: string, branch: string) => void calls.push(`ship ${env} ${branch}`), review: async (pr: number) => void calls.push(`review ${pr}`) };
};

test("the host is woken once, before the first delegation, and never in a dry run", async () => {
  const host = recordingHost();
  const { client, writes } = world();
  await apply(changeset(), client, { dryRun: true, toolbox: host });
  assert.deepEqual(host.calls, []);
  await apply(changeset(), client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake"]);
  assert.ok(writes.some((w) => w.startsWith("delegate ")));
  // Nothing left to delegate: no reason to wake the host.
  await apply(changeset(), client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake"]);
});

test("a ship wakes the host, ships to the issue's branch, notes it, and never ships twice", async () => {
  const host = recordingHost();
  const { client, writes } = world();
  const cs = { ...changeset(), delegate: [], ship: [{ issue: "CIT-465", env: "amazed-bluebird" }] };

  const dry = await apply(cs, client, { dryRun: true, toolbox: host });
  assert.deepEqual(dry.applied.filter((o) => o.op === "ship"), [{ op: "ship", target: "CIT-465", detail: "amazed-bluebird to branch-cit-465" }]);
  assert.deepEqual(host.calls, []);

  await apply(cs, client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake", "ship amazed-bluebird branch-cit-465"]);
  assert.ok(writes.some((w) => w.startsWith("comment CIT-465 ") && w.includes(shipMarker("amazed-bluebird"))));

  const again = await apply(cs, client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake", "ship amazed-bluebird branch-cit-465"]);
  assert.equal(again.applied.some((o) => o.op === "ship"), false);
});

test("an ask hands an issue back to the agent that has it: posted, delegated afresh, once", async () => {
  const host = recordingHost();
  const { client, store, writes } = world();
  store.get("CIT-465")!.delegate = "tidelands-agent";
  const ask = "The ship of amazed-bluebird conflicts with main in cards.ts: bring the environment up to date with main.";
  const cs = { ...changeset(), clusters: [], decline: [], duplicate: [], escalate: [], delegate: [{ issue: "CIT-465", agent: "tidelands-agent", ask }] };

  const dry = await apply(cs, client, { dryRun: true, toolbox: host });
  assert.deepEqual(dry.applied.map((o) => `${o.op} ${o.target}`), ["delegate CIT-465"]);
  assert.deepEqual(writes, []);

  await apply(cs, client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake"]);
  assert.deepEqual(
    writes.map((w) => w.split("\n")[0]),
    [`comment CIT-465 ${ask}`, "undelegate CIT-465", "delegate CIT-465 tidelands-agent"],
  );
  assert.ok(writes[0]!.includes(askMarker(ask)));
  assert.equal(store.get("CIT-465")!.delegate, "tidelands-agent");

  const again = await apply(cs, client, { dryRun: false, toolbox: host });
  assert.equal(again.applied.length, 0);
  assert.equal(writes.length, 3);
});

test("after an ask, the environment it hands back can be shipped again", async () => {
  const host = recordingHost();
  const { client, store } = world();
  const ship = { ...changeset(), clusters: [], decline: [], duplicate: [], escalate: [], delegate: [], ship: [{ issue: "CIT-465", env: "amazed-bluebird" }] };
  await apply(ship, client, { dryRun: false, toolbox: host });
  const back = { ...ship, seen: { "CIT-465": store.get("CIT-465")!.updatedAt }, ship: [], delegate: [{ issue: "CIT-465", agent: "tidelands-agent", ask: "Rebase amazed-bluebird onto main." }] };
  await apply(back, client, { dryRun: false, toolbox: host });
  const again = await apply(ship, client, { dryRun: false, toolbox: host });
  assert.deepEqual(again.applied.map((o) => `${o.op} ${o.target}`), ["ship CIT-465"]);
  assert.deepEqual(host.calls.filter((c) => c.startsWith("ship")), ["ship amazed-bluebird branch-cit-465", "ship amazed-bluebird branch-cit-465"]);
});

test("an ask must be for an existing issue, and not blank", () => {
  const cs = changeset();
  cs.delegate = [{ issue: "new:review-findings", agent: "tidelands-agent", ask: "do it" }];
  assert.ok(validate(cs).some((p) => p.includes("has an ask")));
  cs.delegate = [{ issue: "CIT-503", agent: "tidelands-agent", ask: " " }];
  assert.ok(validate(cs).some((p) => p.includes("has an ask")));
});

test("a review wakes the host, reviews the pull request, notes it, and never reviews it twice", async () => {
  const host = recordingHost();
  const { client, writes } = world();
  const cs = { ...changeset(), delegate: [], review: [{ issue: "CIT-465", pr: 240 }] };

  const dry = await apply(cs, client, { dryRun: true, toolbox: host });
  assert.deepEqual(dry.applied.filter((o) => o.op === "review"), [{ op: "review", target: "CIT-465", detail: "PR #240 (codex_review)" }]);
  assert.deepEqual(host.calls, []);

  await apply(cs, client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake", "review 240"]);
  assert.ok(writes.some((w) => w.startsWith("comment CIT-465 ") && w.includes(reviewMarker(240))));

  const again = await apply(cs, client, { dryRun: false, toolbox: host });
  assert.deepEqual(host.calls, ["wake", "review 240"]);
  assert.equal(again.applied.some((o) => o.op === "review"), false);
});

test("done completes an issue once, with its evidence", async () => {
  const { client, store, writes } = world();
  const cs = { ...changeset(), delegate: [], done: [{ issue: "CIT-465", evidence: "PR #240 merged" }] };

  const dry = await apply(cs, client, { dryRun: true, toolbox: idleHost });
  assert.deepEqual(dry.applied.filter((o) => o.op === "done"), [{ op: "done", target: "CIT-465", detail: "PR #240 merged" }]);
  assert.equal(writes.length, 0);

  await apply(cs, client, { dryRun: false, toolbox: idleHost });
  assert.equal(store.get("CIT-465")!.stage, "completed");
  assert.ok(writes.includes("complete CIT-465"));
  assert.ok(writes.some((w) => w.startsWith("comment CIT-465 ") && w.includes("PR #240 merged")));

  const again = await apply(cs, client, { dryRun: false, toolbox: idleHost });
  assert.equal(again.applied.some((o) => o.op === "done"), false);
});
