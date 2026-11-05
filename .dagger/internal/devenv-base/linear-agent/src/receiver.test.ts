import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server.ts";
import type { Config } from "./config.ts";

// The real createServer, with Linear's GraphQL API replaced by a local fake so
// nothing leaves the machine. Every GraphQL request is recorded; mutations are
// answered with an error, which ends a run right after its first activity
// attempt and before any Claude process could start.
interface Fake {
  url: string;
  mutations: number;
  queries: number;
  failQueries: boolean;
  close(): void;
}

async function fakeLinear(): Promise<Fake> {
  const fake = { mutations: 0, queries: 0, failQueries: false } as Fake;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { query } = JSON.parse(raw) as { query: string };
      res.setHeader("Content-Type", "application/json");
      if (/^\s*mutation/.test(query)) {
        fake.mutations++;
        res.end(JSON.stringify({ errors: [{ message: "fake: no mutations" }] }));
        return;
      }
      fake.queries++;
      if (fake.failQueries) {
        res.statusCode = 503;
        res.end("{}");
        return;
      }
      res.end(
        JSON.stringify({
          data: {
            issue: {
              id: "issue-1", identifier: "CIT-1", title: "t", url: "http://x", priorityLabel: "High",
              description: "d", branchName: "b", reactions: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
              sharedAccess: { isShared: false, sharedWithUsers: [], disallowedIssueFields: [] }, state: { id: "s", name: "Todo" },
              comments: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  fake.close = () => server.close();
  return fake;
}

const secret = "receiver-secret";

function event(action: "created" | "prompted", session: string, activity: string): string {
  return JSON.stringify({
    type: "AgentSessionEvent", action, appUserId: "app-1", oauthClientId: "c", organizationId: "o", webhookId: "w",
    webhookTimestamp: Date.now(), createdAt: new Date().toISOString(),
    promptContext: action === "created" ? "do the work" : undefined,
    agentActivity: action === "prompted" ? { id: activity, content: { type: "prompt", body: "more" } } : undefined,
    agentSession: { id: session, appUserId: "app-1", organizationId: "o", status: "active", type: "commentThread", issueId: "issue-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  });
}

function post(port: number, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/webhooks/linear", method: "POST", headers: {
        "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)),
        "linear-signature": createHmac("sha256", secret).update(body).digest("hex") } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function withReceiver(fn: (port: number, fake: Fake, stateDir: string) => Promise<void>): Promise<void> {
  const fake = await fakeLinear();
  const stateDir = mkdtempSync(join(tmpdir(), "receiver-claims-"));
  process.env.LINEAR_AGENT_STATE_DIR = stateDir;
  const cfg: Config = {
    port: 0, linearClientId: "c", linearClientSecret: "s", linearWebhookSecret: secret, oauthRedirectUrl: "http://x/cb",
    linearInstallToken: "token", linearApiUrl: fake.url, claudeCodeOAuthToken: "unused", runtime: "claude",
  };
  const server = createServer(cfg);
  await new Promise<void>((r) => server.listen(0, r));
  try {
    await fn((server.address() as AddressInfo).port, fake, stateDir);
  } finally {
    server.close();
    fake.close();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 150));

test("a prompt-build failure is a 500, leaves the event unclaimed, and the retry runs once", async () => {
  await withReceiver(async (port, fake, stateDir) => {
    const body = event("prompted", "s1", "act-1");
    fake.failQueries = true;
    assert.equal(await post(port, body), 500);
    await settle();
    assert.equal(fake.mutations, 0, "no work started");
    assert.equal(readdirSync(stateDir).length, 0, "nothing claimed");

    fake.failQueries = false;
    assert.equal(await post(port, body), 200); // Linear's / the relay's retry
    await settle();
    assert.equal(fake.mutations, 1);
    assert.equal(readdirSync(stateDir).length, 1, "claim persisted");
    assert.equal(await post(port, body), 200); // a later duplicate
    await settle();
    assert.equal(fake.mutations, 1, "no second run");
  });
});

test("concurrent duplicate deliveries start one run", async () => {
  await withReceiver(async (port, fake) => {
    const body = event("created", "s2", "");
    const codes = await Promise.all([post(port, body), post(port, body), post(port, body)]);
    assert.deepEqual(codes, [200, 200, 200]);
    await settle();
    assert.equal(fake.mutations, 1);
  });
});

test("a claim that cannot be recorded is a 500 and no work starts", async () => {
  await withReceiver(async (port, fake, stateDir) => {
    const notADir = join(stateDir, "file");
    writeFileSync(notADir, "x");
    process.env.LINEAR_AGENT_STATE_DIR = join(notADir, "claims"); // cannot be created under a file
    assert.equal(await post(port, event("created", "s3", "")), 500);
    await settle();
    assert.equal(fake.mutations, 0);

    process.env.LINEAR_AGENT_STATE_DIR = stateDir; // fixed: the retry is accepted and runs
    assert.equal(await post(port, event("created", "s3", "")), 200);
    await settle();
    assert.equal(fake.mutations, 1);
    assert.ok(existsSync(stateDir));
  });
});
