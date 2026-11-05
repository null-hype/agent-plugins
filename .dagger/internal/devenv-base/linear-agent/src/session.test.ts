import { test } from "node:test";
import assert from "node:assert/strict";
import type { LinearClient } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload, EntityWebhookPayloadWithIssueData } from "@linear/sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimEvent } from "./claims.ts";
import type { AgentRunner } from "./runner.ts";
import { handleAgentSessionEvent, handleIssueEvent } from "./session.ts";

const noRunner: AgentRunner = async () => {
  throw new Error("no model run in these tests");
};

process.env.LINEAR_AGENT_STATE_DIR = mkdtempSync(join(tmpdir(), "agent-claims-"));

// A stub that fails the test if createAgentActivity is ever called — used to
// assert the negative-path guards in handleIssueEvent short-circuit before
// touching Linear or Claude, mirroring how webhook.test.ts uses action
// "created" with no promptContext to exercise real code without network
// access.
function unreachableLinear(): LinearClient {
  return {
    createAgentActivity: async () => {
      assert.fail("createAgentActivity should not have been called");
    },
  } as unknown as LinearClient;
}

function agentSessionEventPayload(
  overrides: Partial<AgentSessionEventWebhookPayload> & { agentSession: AgentSessionEventWebhookPayload["agentSession"] },
): AgentSessionEventWebhookPayload {
  return {
    type: "AgentSessionEvent",
    action: "created",
    appUserId: "app-user-1",
    oauthClientId: "oauth-client-1",
    organizationId: "org-1",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    createdAt: new Date().toISOString(),
    ...overrides,
  } as AgentSessionEventWebhookPayload;
}

function issueEventPayload(overrides: Partial<EntityWebhookPayloadWithIssueData>): EntityWebhookPayloadWithIssueData {
  return {
    type: "Issue",
    action: "update",
    organizationId: "org-1",
    webhookId: "webhook-2",
    webhookTimestamp: Date.now(),
    createdAt: new Date().toISOString(),
    data: { id: "issue-1", description: "new description" },
    ...overrides,
  } as EntityWebhookPayloadWithIssueData;
}

test("handleIssueEvent ignores a description-less update", async () => {
  await handleAgentSessionEvent(
    agentSessionEventPayload({
      agentSession: { id: "session-1", issueId: "issue-1", status: "pending" } as AgentSessionEventWebhookPayload["agentSession"],
    }),
    unreachableLinear(),
    noRunner,
  );

  await handleIssueEvent(
    issueEventPayload({ data: { id: "issue-1", title: "renamed" } as unknown as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { title: "old title" } }),
    unreachableLinear(),
    noRunner,
  );
});

test("handleIssueEvent ignores an issue with no tracked session", async () => {
  await handleIssueEvent(
    issueEventPayload({ data: { id: "issue-never-delegated", description: "x" } as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { description: "old" } }),
    unreachableLinear(),
    noRunner,
  );
});

test("handleIssueEvent ignores non-update actions", async () => {
  await handleAgentSessionEvent(
    agentSessionEventPayload({
      agentSession: { id: "session-2", issueId: "issue-2", status: "pending" } as AgentSessionEventWebhookPayload["agentSession"],
    }),
    unreachableLinear(),
    noRunner,
  );

  await handleIssueEvent(
    issueEventPayload({ action: "create", data: { id: "issue-2", description: "x" } as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { description: "old" } }),
    unreachableLinear(),
    noRunner,
  );
});

test("handleIssueEvent stops reacting once the session is terminal", async () => {
  await handleAgentSessionEvent(
    agentSessionEventPayload({
      agentSession: { id: "session-3", issueId: "issue-3", status: "complete" } as AgentSessionEventWebhookPayload["agentSession"],
    }),
    unreachableLinear(),
    noRunner,
  );

  await handleIssueEvent(
    issueEventPayload({ data: { id: "issue-3", description: "x" } as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { description: "old" } }),
    unreachableLinear(),
    noRunner,
  );
});

test("a repeated delivery of the same event does not start another run", async () => {
  let thoughts = 0;
  const linear = {
    createAgentActivity: async () => {
      thoughts++;
      throw new Error("stop before claude runs");
    },
  } as unknown as LinearClient;
  const created = agentSessionEventPayload({
    agentSession: { id: "session-dup", issueId: "issue-dup", status: "pending" } as AgentSessionEventWebhookPayload["agentSession"],
    promptContext: "do the work",
  });
  await assert.rejects(handleAgentSessionEvent(created, linear, noRunner));
  await handleAgentSessionEvent(created, linear, noRunner);
  await handleAgentSessionEvent(created, linear, noRunner);
  assert.equal(thoughts, 1);

  const prompted = (id: string) =>
    agentSessionEventPayload({
      action: "prompted",
      agentSession: { id: "session-dup", issueId: "issue-dup", status: "active" } as AgentSessionEventWebhookPayload["agentSession"],
      agentActivity: { id, content: { type: "prompt", body: "again" } } as unknown as AgentSessionEventWebhookPayload["agentActivity"],
    });
  // A prompted delivery builds its prompt from Linear before it claims: while
  // that fails the event stays unclaimed, so a retry is not mistaken for a repeat.
  const unreadable = { ...linear, issue: async () => { throw new Error("no issue"); } } as unknown as LinearClient;
  await assert.rejects(handleAgentSessionEvent(prompted("act-1"), unreadable, noRunner));
  await assert.rejects(handleAgentSessionEvent(prompted("act-1"), unreadable, noRunner));
  assert.equal(claimEvent("prompted:session-dup:act-1"), true, "nothing was claimed by the failures");
});

test("claims survive a restart because they are files, and a different event is not a duplicate", () => {
  assert.equal(claimEvent("created:s-x"), true);
  assert.equal(claimEvent("created:s-x"), false);
  assert.equal(claimEvent("created:s-y"), true);
});
