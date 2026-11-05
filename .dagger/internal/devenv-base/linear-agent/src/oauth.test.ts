import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "./config.ts";
import { authorizeUrl } from "./oauth.ts";

test("app installations request permission to post agent activities", () => {
  const url = new URL(authorizeUrl({
    linearClientId: "client",
    oauthRedirectUrl: "https://agent.example/oauth/callback",
  } as Config));
  assert.equal(url.searchParams.get("actor"), "app");
  assert.deepEqual(new Set(url.searchParams.get("scope")?.split(",")),
    new Set(["write", "app:assignable", "app:mentionable"]));
});
