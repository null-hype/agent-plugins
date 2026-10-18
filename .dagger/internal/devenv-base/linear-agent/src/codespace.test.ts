import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LinearClient } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload } from "@linear/sdk";

// A fake `gh` on PATH: records each call, keeps the codespaces it "created",
// and answers `gh cs ssh` with a short stream-json turn after a delay, so a
// second event can arrive mid-turn.
const dir = mkdtempSync(path.join(tmpdir(), "fake-gh-"));
const log = path.join(dir, "calls.log");
writeFileSync(log, "");
writeFileSync(
  path.join(dir, "gh"),
  `#!/bin/bash
echo "$*" >> ${log}
case "$1 $2" in
  "cs list") cat ${dir}/codespaces.json 2>/dev/null || echo '[]' ;;
  "cs create") sleep 0.3; echo '[{"name":"cs-fake","displayName":"agent-11111111"}]' > ${dir}/codespaces.json; echo cs-fake ;;
  "cs ssh") echo "stdin: $(cat)" >> ${log}; sleep 0.2
    echo 'Welcome to the codespace'
    echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -am fix"}}]}}'
    echo '{"type":"result","subtype":"success","result":"Committed the fix."}' ;;
esac
`,
);
chmodSync(path.join(dir, "gh"), 0o755);
process.env.PATH = `${dir}:${process.env.PATH}`;
process.env.LINEAR_AGENT_SANDBOX = "codespace";
const { handleAgentSessionEvent } = await import("./session.ts");

const SESSION = "11111111-2222-3333-4444-555555555555";
const activities: Record<string, unknown>[] = [];
const linear = {
  createAgentActivity: async ({ content }: { content: Record<string, unknown> }) => void activities.push(content),
} as unknown as LinearClient;

function event(action: "created" | "prompted", extra: object): AgentSessionEventWebhookPayload {
  return {
    type: "AgentSessionEvent",
    action,
    appUserId: "app-user-1",
    oauthClientId: "oauth-client-1",
    organizationId: "org-1",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    createdAt: new Date().toISOString(),
    agentSession: { id: SESSION, issueId: "issue-1", status: "active" },
    ...extra,
  } as unknown as AgentSessionEventWebhookPayload;
}

test("created makes the session's codespace; a prompt mid-turn resumes it instead of making another", async () => {
  const first = handleAgentSessionEvent(event("created", { promptContext: "Fix JIN-1." }), linear, "token");
  await new Promise((r) => setTimeout(r, 50));
  const second = handleAgentSessionEvent(
    event("prompted", { agentActivity: { content: { type: "prompt", body: "Also add a test." } } }),
    linear,
    "token",
  );
  await Promise.all([first, second]);

  const calls = readFileSync(log, "utf8").split("\n");
  assert.equal(calls.filter((c) => c.startsWith("cs create")).length, 1);
  assert.match(calls.find((c) => c.startsWith("cs create"))!, /--display-name agent-11111111/);
  const ssh = calls.filter((c) => c.startsWith("cs ssh"));
  assert.equal(ssh.length, 2);
  assert.match(ssh[0], new RegExp(`-c cs-fake -- .*--session-id ${SESSION}$`));
  assert.match(ssh[1], new RegExp(`-c cs-fake -- .*--resume ${SESSION}$`));
  assert.ok(ssh.every((c) => c.includes("git remote set-url --push origin no-push &&")));
  // Prompts travel over stdin, and a resumed turn gets only the new message.
  assert.ok(calls.includes("stdin: Fix JIN-1."));
  assert.ok(calls.includes("stdin: Also add a test."));
  assert.ok(!ssh.some((c) => c.includes("JIN-1")));

  assert.deepEqual(activities.filter((a) => a.type === "response").map((a) => a.body), ["Committed the fix.", "Committed the fix."]);
  assert.ok(activities.some((a) => a.type === "action" && a.action === "Bash"));
});
