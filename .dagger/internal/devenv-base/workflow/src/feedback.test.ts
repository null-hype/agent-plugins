import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareFeedback, recordFeedback, feedbackBlock, renderFeedback, resolveOperation, operationReferences, FeedbackError, type FeedbackItem } from "./feedback.ts";
import { apply, type LinearClient } from "./apply.ts";
import { sourceRevision, BOOTSTRAP_INITIATIVES, type InitiativeContext } from "./initiatives.ts";

const update = JSON.parse(await readFile(new URL("./fixtures/initiative-zero-update.json", import.meta.url), "utf8"));
const source = { ...update, initiativeId: BOOTSTRAP_INITIATIVES[0], kind: "update" as const, revision: sourceRevision(update.body, update.updatedAt) };
const initiative: InitiativeContext = { id: source.initiativeId, name: "Initiative Zero", url: source.url, projects: [], sources: [source] };
const item: FeedbackItem = {
  key: "planning-integration", summary: "Finish CIT-518 input preparation", disposition: "adopted", status: "open",
  rationale: "The read hotfix did not implement input preparation; prioritize the integration alongside Duo.",
  operations: [{ op: "delegate", target: "CIT-518" }], noAction: "", evidence: [],
};
const decision = (items = [item]) => ({ decisions: [{ sourceId: source.id, revision: source.revision, items }] });

test("one traceable update reaches input, disposition, artifact and PR with a proposed action", () => {
  const input = prepareFeedback([initiative]);
  assert.equal(input.initiatives[0].sources[0].body, update.body);
  const response = `Findings\nSUPERVISOR_FEEDBACK:\n\`\`\`json\n${JSON.stringify(decision())}\n\`\`\`\nSUPERVISOR_CHANGESET:\n\`\`\`pkl\n\`\`\``;
  const ledger = recordFeedback(input, feedbackBlock(response), item.operations);
  const pr = renderFeedback(ledger);
  assert(pr.includes(source.url) && pr.includes(source.revision));
  assert(pr.includes("adopted; open") && pr.includes(item.rationale));
  assert(pr.includes("Proposed for subsequent apply: delegate CIT-518"));
  assert(pr.includes("adoption is not completion"));
});

test("a zero-operation, reasoned disposition survives and unresolved feedback needs no duplicate dispatch", () => {
  const first = recordFeedback(prepareFeedback([initiative]), decision(), item.operations);
  const deferred: FeedbackItem = { ...item, disposition: "deferred", operations: [], noAction: "The maintainer's integration PR is underway; do not delegate it again." };
  const next = recordFeedback(prepareFeedback([initiative], first), decision([deferred]), []);
  assert.equal(next.records[0].items[0].status, "open");
  assert.deepEqual(next.records[0].items[0].operations, []);
  assert(renderFeedback(next).includes(deferred.noAction));
  const same = recordFeedback(prepareFeedback([initiative], next), decision([deferred]), []);
  assert.deepEqual(same, next, "the same decisions do not create hourly metadata churn");
});

test("missing input, disposition, rationale, revision and unknown proposed operations fail", () => {
  const input = prepareFeedback([initiative]);
  assert.throws(() => prepareFeedback([]), /no initiative input/);
  assert.throws(() => feedbackBlock("prose only"), /one SUPERVISOR_FEEDBACK/);
  assert.throws(() => recordFeedback(input, { decisions: [] }, []), /missing disposition/);
  assert.throws(() => recordFeedback(input, { decisions: [{ ...decision().decisions[0], revision: "stale" }] }, []), /unknown source\/revision/);
  assert.throws(() => recordFeedback(input, decision([{ ...item, rationale: "" }]), item.operations), /invalid decision item/);
  assert.throws(() => recordFeedback(input, decision(), []), /absent from this dry run/);
  assert.throws(() => recordFeedback(input, decision([{ ...item, status: "resolved" }]), item.operations), /still open/);
  assert.throws(() => recordFeedback(input, decision([{ ...item, operations: [], status: "resolved", noAction: "Done" }]), []), /resolution needs evidence/);
});

test("edited update IDs are rediscovered, explicitly supersede old revisions and retain prior recommendations", () => {
  const first = recordFeedback(prepareFeedback([initiative]), decision(), item.operations);
  const editedSource = { ...source, body: source.body + "\nNew maintainer clarification." };
  editedSource.revision = sourceRevision(editedSource.body, editedSource.updatedAt);
  const edited = prepareFeedback([{ ...initiative, sources: [editedSource] }], first);
  const response = { decisions: [{ ...decision().decisions[0], revision: editedSource.revision }] };
  assert.throws(() => recordFeedback(edited, response, item.operations), /explicitly supersede/);
  const ledger = recordFeedback(edited, { decisions: [{ ...response.decisions[0], supersedes: source.revision }] }, item.operations);
  assert.equal(ledger.records.length, 2);
  assert.equal(ledger.records.find((r) => r.source.revision === source.revision)!.supersededBy, editedSource.revision);
  assert(!renderFeedback(ledger).includes(`Revision: \`${source.revision}\``));
  assert.throws(() => recordFeedback(edited, { decisions: [{ ...response.decisions[0], items: [{ ...item, key: "forget-old" }] }] }, item.operations), /lost recommendation/);
  assert.throws(() => prepareFeedback([{ ...initiative, sources: [{ ...source, id: "different" }] }], first), /previous source .* is missing/);
});

test("PR text cannot create mentions or inject an unvalidated source link", () => {
  const ledger = recordFeedback(prepareFeedback([initiative]), decision([{ ...item, rationale: "@claude <tag> | [fake](https://example.com)" }]), item.operations);
  const pr = renderFeedback(ledger);
  assert(!pr.includes("@claude") && !pr.includes("<tag>"));
  assert(pr.includes("&#64;claude"));
  assert.throws(() => prepareFeedback([{ ...initiative, sources: [{ ...source, url: "https://example.com/fake" }] }]), /source URL/);
});

// CIT-523: the 2026-10-23 01:13 UTC run. The planner's corrected answer
// (recorded verbatim) named its new cluster `cluster new:apply-reliability`;
// the dry run calls that op `create`, and validation threw the plan away.
// Its changeset is replayed through a dry run against a read-only Linear, so
// the references come from apply itself. Only update b763920f's decision is
// used: it is the one source whose exact body is a fixture here.
const recorded = await readFile(new URL("./fixtures/planner-response-2026-10-23T0120.txt", import.meta.url), "utf8");
const recordedChangeset = JSON.parse(await readFile(new URL("./fixtures/changeset-2026-10-23T0120.json", import.meta.url), "utf8"));
const readOnlyLinear = (seen: Record<string, string>): LinearClient => {
  const none = async () => { throw new Error("a dry run wrote to Linear"); };
  return {
    issue: async (id) => (id in seen ? { identifier: id, updatedAt: seen[id], stage: "backlog", labels: [], blockedBy: [], releases: [], branch: `${id.toLowerCase()}-branch`, shipped: [], reviewed: [] } : null),
    findByMarker: async () => null, hasLabel: async () => true, hasUser: async () => true, hasPipeline: async () => true, hasRelease: async () => false,
    createIssue: none, setParent: none, addBlocks: none, cancel: none, complete: none, markDuplicate: none, addLabel: none, createLabel: none,
    comment: none, delegate: none, undelegate: none, createPipeline: none, createRelease: none, addToRelease: none,
  };
};
const recordedDryRun = (await apply(recordedChangeset, readOnlyLinear(recordedChangeset.seen), { dryRun: true })).applied;
const recordedDecision = (feedbackBlock(recorded) as { decisions: { sourceId: string }[] }).decisions.filter((d) => d.sourceId === source.id);

test("the recorded cluster/create mismatch resolves to the dry run's own op, and is stored that way", () => {
  assert.equal(recordedDecision.length, 1, "the recorded response answers update b763920f");
  assert.ok(recordedDryRun.some((o) => o.op === "create" && o.target === "new:apply-reliability"));
  assert.ok(!recordedDryRun.some((o) => (o.op as string) === "cluster"), "the dry run has no op called cluster");
  const ledger = recordFeedback(prepareFeedback([initiative]), { decisions: recordedDecision }, recordedDryRun);
  const items = ledger.records[0].items;
  const coordination = items.find((i) => i.key === "ship-coordination")!;
  assert.deepEqual(coordination.operations, [{ op: "create", target: "new:apply-reliability" }]);
  assert.deepEqual(items.find((i) => i.key === "retry-one-ship")!.operations, [{ op: "review", target: "CIT-516" }, { op: "ship", target: "CIT-501" }]);
  assert.ok(items.every((i) => i.operations.every((o) => o.op !== "cluster")));
  assert(renderFeedback(ledger).includes("Proposed for subsequent apply: create new:apply-reliability."));
  // The same answer next hour, against the same dry run, is the same ledger.
  assert.deepEqual(recordFeedback(prepareFeedback([initiative], ledger), { decisions: recordedDecision }, recordedDryRun), ledger);
});

test("unknown, nonexistent and ambiguous references are refused, all at once, with the valid ones listed", () => {
  const input = prepareFeedback([initiative]);
  const bad = (operations: { op: string; target: string }[], key = "bad") => ({ ...item, key, operations });
  const response = decision([bad([{ op: "cluster", target: "new:never-planned" }], "a"), bad([{ op: "frobnicate", target: "CIT-1" }], "b"), bad([{ op: "delegate", target: "CIT-999" }], "c")]);
  assert.throws(() => recordFeedback(input, response, recordedDryRun), (e: FeedbackError) => {
    assert.equal(e.problems.length, 3);
    assert.match(e.problems[0], /a refers to an operation absent from this dry run: cluster new:never-planned is absent/);
    assert.match(e.problems[1], /frobnicate is not an operation/);
    assert.match(e.problems[2], /delegate CIT-999 is absent/);
    return true;
  });
  assert.match(String(resolveOperation({ op: "cluster", target: "CIT-1" }, [{ op: "attach", target: "CIT-1" }, { op: "parent", target: "CIT-1" }])), /ambiguous.*attach CIT-1, parent CIT-1/);
  assert.deepEqual(resolveOperation({ op: "cluster", target: "CIT-1" }, [{ op: "parent", target: "CIT-1" }]), { op: "parent", target: "CIT-1" });
  assert.deepEqual(operationReferences(recordedDryRun), ["release supervisor-workflow", "create new:apply-reliability", "parent CIT-450", "ship CIT-501", "review CIT-516"]);
});
