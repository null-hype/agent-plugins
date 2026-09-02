import { test } from "node:test";
import assert from "node:assert/strict";
import type { LinearClient } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload, EntityWebhookPayloadWithIssueData } from "@linear/sdk";
import { handleAgentSessionEvent, handleIssueEvent } from "./session.ts";

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
    "token",
  );

  await handleIssueEvent(
    issueEventPayload({ data: { id: "issue-1", title: "renamed" } as unknown as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { title: "old title" } }),
    unreachableLinear(),
    "token",
  );
});

test("handleIssueEvent ignores an issue with no tracked session", async () => {
  await handleIssueEvent(
    issueEventPayload({ data: { id: "issue-never-delegated", description: "x" } as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { description: "old" } }),
    unreachableLinear(),
    "token",
  );
});

test("handleIssueEvent ignores non-update actions", async () => {
  await handleAgentSessionEvent(
    agentSessionEventPayload({
      agentSession: { id: "session-2", issueId: "issue-2", status: "pending" } as AgentSessionEventWebhookPayload["agentSession"],
    }),
    unreachableLinear(),
    "token",
  );

  await handleIssueEvent(
    issueEventPayload({ action: "create", data: { id: "issue-2", description: "x" } as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { description: "old" } }),
    unreachableLinear(),
    "token",
  );
});

test("handleIssueEvent stops reacting once the session is terminal", async () => {
  await handleAgentSessionEvent(
    agentSessionEventPayload({
      agentSession: { id: "session-3", issueId: "issue-3", status: "complete" } as AgentSessionEventWebhookPayload["agentSession"],
    }),
    unreachableLinear(),
    "token",
  );

  await handleIssueEvent(
    issueEventPayload({ data: { id: "issue-3", description: "x" } as EntityWebhookPayloadWithIssueData["data"], updatedFrom: { description: "old" } }),
    unreachableLinear(),
    "token",
  );
});
