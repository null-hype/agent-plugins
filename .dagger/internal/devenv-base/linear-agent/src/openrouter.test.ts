import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.ts";
import { cheapestOpenModel, MIN_CONTEXT, resetModelCache, resolveModel, type OpenRouterModel } from "./models.ts";
import { callModel } from "@openrouter/agent";
import { OpenRouter } from "@openrouter/agent/openrouter";
// @openrouter/agent's own dependency, for a client that records the request.
import { HTTPClient } from "@openrouter/sdk/lib/http.js";
import { instructions, narrate, toolResultText, traceTags } from "./openrouter.ts";

const linearEnv = {
  LINEAR_CLIENT_ID: "c",
  LINEAR_CLIENT_SECRET: "s",
  LINEAR_WEBHOOK_SECRET: "w",
  LINEAR_OAUTH_REDIRECT_URL: "https://openrouter-agent.example/oauth/callback",
};

function model(id: string, prompt: string, completion: string, extra: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id,
    hugging_face_id: `org/${id}`,
    context_length: 131_072,
    pricing: { prompt, completion },
    supported_parameters: ["tools", "tool_choice"],
    ...extra,
  };
}

test("the cheapest open-weight model with tool calling is chosen, by a 3:1 prompt-weighted price", () => {
  const models = [
    model("big/expensive", "0.000001", "0.000004"),
    // Cheaper output, dearer input: 3*0.3 + 0.1 = 1.0 per M, against 3*0.1 + 0.4 = 0.7.
    model("cheap-out/x", "0.0000003", "0.0000001"),
    model("cheap-in/y", "0.0000001", "0.0000004"),
  ];
  assert.equal(cheapestOpenModel(models)?.id, "cheap-in/y");
});

test("closed, free, tool-less, small-context and unpriced models are never chosen", () => {
  const models = [
    model("closed/a", "0.00000001", "0.00000001", { hugging_face_id: "" }),
    model("open/free:free", "0", "0"),
    model("open/notools", "0.00000001", "0.00000001", { supported_parameters: ["temperature"] }),
    model("open/small", "0.00000001", "0.00000001", { context_length: MIN_CONTEXT - 1 }),
    model("open/router", "-1", "-1"),
    model("open/zero", "0", "0.0000001"),
    model("open/ok", "0.0000002", "0.0000006"),
  ];
  assert.equal(cheapestOpenModel(models)?.id, "open/ok");
  assert.equal(cheapestOpenModel(models.slice(0, 6)), undefined);
});

test("ties resolve to the same model every time", () => {
  const a = model("b/same", "0.0000001", "0.0000001");
  const b = model("a/same", "0.0000001", "0.0000001");
  assert.equal(cheapestOpenModel([a, b])?.id, "a/same");
  assert.equal(cheapestOpenModel([b, a])?.id, "a/same");
});

test("a configured model is used as is; otherwise the list is read and cached", async () => {
  resetModelCache();
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: [model("open/one", "0.0000001", "0.0000002")] }));
  }) as typeof fetch;
  assert.equal(await resolveModel("pinned/model", "k", fakeFetch, 0), "pinned/model");
  assert.equal(calls, 0);
  assert.equal(await resolveModel("", "k", fakeFetch, 0), "open/one");
  assert.equal(await resolveModel("", "k", fakeFetch, 1000), "open/one");
  assert.equal(calls, 1, "a second turn within six hours reuses the choice");

  const down = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  assert.equal(await resolveModel("", "k", down, 7 * 60 * 60 * 1000), "open/one", "a failed refresh keeps the last choice");
  resetModelCache();
  await assert.rejects(resolveModel("", "k", down, 0), /503/);
  resetModelCache();
});

test("AGENT_RUNTIME=openrouter needs the OpenRouter key, not a Claude token", () => {
  assert.throws(() => loadConfig({ ...linearEnv, AGENT_RUNTIME: "openrouter" }), /OPENROUTER_API_KEY/);
  const cfg = loadConfig({ ...linearEnv, AGENT_RUNTIME: "openrouter", OPENROUTER_API_KEY: "or-key", PORT: "8081" });
  assert.equal(cfg.runtime, "openrouter");
  assert.equal(cfg.port, 8081);
  assert.deepEqual(cfg.openrouter, { apiKey: "or-key", model: "", maxCostUsd: 0.5, maxSteps: 60 });
  assert.throws(() => loadConfig({ ...linearEnv, AGENT_RUNTIME: "openrouter", OPENROUTER_API_KEY: "k", OPENROUTER_MAX_COST_USD: "0" }), /positive/);
});

test("the Claude runtime is the default and is unchanged", () => {
  assert.throws(() => loadConfig(linearEnv), /CLAUDE_CODE_OAUTH_TOKEN/);
  const cfg = loadConfig({ ...linearEnv, CLAUDE_CODE_OAUTH_TOKEN: "t" });
  assert.equal(cfg.runtime, "claude");
  assert.equal(cfg.openrouter, undefined);
  assert.throws(() => loadConfig({ ...linearEnv, AGENT_RUNTIME: "gpt" }), /AGENT_RUNTIME/);
});

test("a round's output is narrated as thoughts and actions, with noisy tool arguments left out", () => {
  const activities = narrate([
    { type: "reasoning", summary: [{ text: "Look at the failing test first." }] },
    { type: "message", content: [{ type: "output_text", text: "Creating an environment." }] },
    { type: "function_call", name: "environment_create", arguments: '{"environment_source":"/w","title":"fix"}' },
    { type: "function_call", name: "environment_file_write", arguments: '{"contents":"…huge…"}' },
    { type: "message", content: [{ type: "output_text", text: "  " }] },
  ]);
  assert.deepEqual(activities, [
    { type: "thought", body: "Look at the failing test first." },
    { type: "thought", body: "Creating an environment." },
    { type: "action", body: 'environment_create({"environment_source":"/w","title":"fix"})' },
    { type: "action", body: "environment_file_write" },
  ]);
  assert.deepEqual(narrate(undefined), []);
});

test("tool results keep errors visible as errors", () => {
  assert.equal(toolResultText({ content: [{ type: "text", text: "ok" }, { type: "image" }] }), "ok\n[image content omitted]");
  assert.equal(toolResultText({ content: [{ type: "text", text: "exit 1" }], isError: true }), "Error: exit 1");
  assert.equal(toolResultText({ content: [], structuredContent: { id: "amazed-bluebird" } }), '{"id":"amazed-bluebird"}');
});

test("the instructions name the checkout as environment_source and keep the ship contract", () => {
  const text = instructions("/workspaces/linear-agent");
  assert.match(text, /environment_source "\/workspaces\/linear-agent"/);
  assert.match(text, /The supervisor ships it to the issue's branch/);
  assert.doesNotMatch(text, /Edit, Write and Bash/);
});

test("a turn's requests carry its Linear session and one trace for Broadcast", async () => {
  assert.deepEqual(traceTags(undefined), {});
  const tags = traceTags({ agentSessionId: "sess-1", issue: "CIT-1" });
  assert.equal(tags.sessionId, "sess-1");
  assert.match(tags.trace!.traceId, /^[0-9a-f]{32}$/);
  assert.notEqual(traceTags({ agentSessionId: "sess-1" }).trace!.traceId, tags.trace!.traceId, "one trace per turn");

  // What reaches OpenRouter: @openrouter/agent passes these on as session_id
  // and trace, with the metadata flattened into trace.
  let body: Record<string, unknown> | undefined;
  const httpClient = new HTTPClient({
    fetcher: async (input, init) => {
      body = JSON.parse(await (input instanceof Request ? input : new Request(input, init)).text());
      throw new Error("captured");
    },
  });
  const result = callModel(new OpenRouter({ apiKey: "k", httpClient }), { model: "m", input: "hi", ...tags });
  await assert.rejects(result.getText());
  assert.equal(body?.session_id, "sess-1");
  assert.deepEqual(body?.trace, {
    trace_id: tags.trace!.traceId,
    trace_name: "CIT-1 turn",
    runtime: "openrouter",
    linear_session: "sess-1",
    linear_issue: "CIT-1",
  });
});
