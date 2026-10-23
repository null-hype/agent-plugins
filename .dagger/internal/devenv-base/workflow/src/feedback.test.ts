import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareFeedback, recordFeedback, feedbackBlock, renderFeedback, type FeedbackItem } from "./feedback.ts";
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
