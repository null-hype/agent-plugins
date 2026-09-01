import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "./server.ts";
import type { Config } from "./config.ts";

const testConfig: Config = {
  port: 0,
  linearClientId: "test-client-id",
  linearClientSecret: "test-client-secret",
  linearWebhookSecret: "test-webhook-secret",
  oauthRedirectUrl: "https://agent.tidelands.dev/oauth/callback",
  linearInstallToken: "",
  claudeCodeOAuthToken: "test-claude-token",
};

// A minimal AgentSessionEvent payload. action "created" with no
// promptContext short-circuits before any Linear API call, so this
// exercises real signature verification without needing network access.
function samplePayload(): Record<string, unknown> {
  return {
    type: "AgentSessionEvent",
    action: "created",
    appUserId: "app-user-1",
    oauthClientId: "oauth-client-1",
    organizationId: "org-1",
    webhookId: "webhook-1",
    webhookTimestamp: Date.now(),
    createdAt: new Date().toISOString(),
    agentSession: {
      id: "session-1",
      appUserId: "app-user-1",
      organizationId: "org-1",
      status: "pending",
      type: "commentThread",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = createServer(testConfig);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(port);
  } finally {
    server.close();
  }
}

function post(port: number, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/webhooks/linear", method: "POST", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// testConfig has no install token, so a validly-signed AgentSessionEvent is
// structurally unserviceable -- the handler throws (see server.ts), and
// LinearWebhookClient's own try/catch turns that into a 500 instead of
// masking the failure as 200. This is the JIN-36 regression test: before
// the fix this asserted 200.
test("rejects a validly-signed webhook when no install token is configured", async () => {
  await withServer(async (port) => {
    const body = JSON.stringify(samplePayload());
    const status = await post(port, body, {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "linear-signature": sign(body, testConfig.linearWebhookSecret),
    });
    assert.equal(status, 500);
  });
});

test("accepts a webhook with a valid signature when an install token is configured", async () => {
  const configWithToken: Config = { ...testConfig, linearInstallToken: "test-install-token" };
  const server = createServer(configWithToken);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const body = JSON.stringify(samplePayload());
    const status = await post(port, body, {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "linear-signature": sign(body, testConfig.linearWebhookSecret),
    });
    assert.equal(status, 200);
  } finally {
    server.close();
  }
});

test("GET /healthz reports install-token presence", async () => {
  await withServer(async (port) => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/healthz", method: "GET" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end();
    });
    // testConfig has no install token configured.
    assert.equal(status, 503);
  });
});

test("rejects a webhook with an invalid signature", async () => {
  await withServer(async (port) => {
    const body = JSON.stringify(samplePayload());
    const status = await post(port, body, {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "linear-signature": sign(body, "wrong-secret"),
    });
    assert.equal(status, 400);
  });
});

test("rejects a webhook signed for a different body", async () => {
  await withServer(async (port) => {
    const body = JSON.stringify(samplePayload());
    const tamperedSignature = sign(JSON.stringify({ ...samplePayload(), action: "prompted" }), testConfig.linearWebhookSecret);
    const status = await post(port, body, {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      "linear-signature": tamperedSignature,
    });
    assert.equal(status, 400);
  });
});
