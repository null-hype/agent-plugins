import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "./config.ts";
import { mintAppToken } from "./oauth.ts";

const cfg = { linearClientId: "client", linearClientSecret: "secret" } as Config;

test("mintAppToken asks for an app token with the client credentials", async (t) => {
  let sent: URLSearchParams | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent = new URLSearchParams(String(init.body));
    return new Response(JSON.stringify({ access_token: "app-token", token_type: "Bearer", scope: "" }));
  });

  assert.equal(await mintAppToken(cfg), "app-token");
  assert.equal(sent?.get("grant_type"), "client_credentials");
  assert.equal(sent?.get("client_id"), "client");
  assert.equal(sent?.get("client_secret"), "secret");
  assert.equal(sent?.get("scope"), "read,write,app:assignable,app:mentionable");
});

test("mintAppToken fails loudly when Linear refuses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("invalid_client", { status: 401 }));
  await assert.rejects(mintAppToken(cfg), /client_credentials token mint failed: 401 invalid_client/);
});
