import { test } from "node:test";
import assert from "node:assert/strict";
import { toolboxClient, wakeHost, type ToolResult } from "./toolbox.ts";

function fakeToolbox(answer: (method: string, params: Record<string, unknown>) => unknown, sent: { method: string; session: string | null; auth: string | null }[] = []) {
  return (async (_url: string, init: RequestInit) => {
    const msg = JSON.parse(init.body as string);
    const h = new Headers(init.headers);
    sent.push({ method: msg.method, session: h.get("mcp-session-id"), auth: h.get("authorization") });
    if (!("id" in msg)) return new Response(null, { status: 202 });
    const body = { jsonrpc: "2.0", id: msg.id, ...(answer(msg.method, msg.params) as object) };
    // The toolbox answers tools/call as an event stream.
    return msg.method === "tools/call"
      ? new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream" } })
      : new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "mcp-session-id": "s-1" } });
  }) as typeof fetch;
}

test("a call initializes once, then calls the tool in that session with the bearer token", async () => {
  const sent: { method: string; session: string | null; auth: string | null }[] = [];
  const calls: unknown[] = [];
  const client = toolboxClient(
    "tok",
    "https://toolbox/mcp",
    fakeToolbox((method, params) => {
      if (method === "tools/call") calls.push(params);
      return method === "initialize" ? { result: {} } : { result: { content: [{ type: "text", text: "the host is starting" }] } };
    }, sent),
  );
  assert.deepEqual(await client.call("host_start"), { text: "the host is starting" });
  await client.call("agent_ship", { env: "trusty-burro", branch: "cit-500-x" });
  assert.deepEqual(sent.map((s) => `${s.method} ${s.session}`), ["initialize null", "notifications/initialized s-1", "tools/call s-1", "tools/call s-1"]);
  assert.ok(sent.every((s) => s.auth === "Bearer tok"));
  assert.deepEqual(calls[1], { name: "agent_ship", arguments: { env: "trusty-burro", branch: "cit-500-x" } });
});

test("a tool error is a failed call, not a result", async () => {
  const client = toolboxClient(
    "tok",
    "https://toolbox/mcp",
    fakeToolbox((method) => (method === "initialize" ? { result: {} } : { result: { isError: true, content: [{ type: "text", text: "workspace x has a job in progress" }] } })),
  );
  await assert.rejects(client.call("host_stop"), /toolbox host_stop: workspace x has a job in progress/);
});

test("a task cannot reach a tool outside its list", async () => {
  const client = toolboxClient("tok", "https://toolbox/mcp", fakeToolbox(() => ({ result: {} })));
  await assert.rejects(client.call("workspace_delete" as never), /may not call toolbox tool workspace_delete/);
});

const scripted = (phases: Record<string, unknown>[]) => {
  const calls: string[] = [];
  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    calls.push(Object.keys(args).length ? `${tool} ${JSON.stringify(args)}` : tool);
    if (tool === "host_wake") return { text: JSON.stringify(phases[0]), structured: phases.length > 1 ? phases.shift() : phases[0] };
    return { text: tool === "workspace_status" ? "exit 1: pass login timed out" : "ok" };
  };
  return { calls, call };
};

test("wakeHost retries a failed agent start once, then waits for ready", async () => {
  const tb = scripted([{ phase: "booting" }, { phase: "agent-failed" }, { phase: "agent-starting" }, { phase: "ready", ready: true }]);
  await wakeHost(tb.call, { pause: 0 });
  assert.deepEqual(tb.calls, ["host_wake", "host_wake", "agent_start", "host_wake", "host_wake"]);
});

test("wakeHost fails with the agent's log when its start fails twice", async () => {
  const tb = scripted([{ phase: "agent-failed" }, { phase: "agent-starting" }, { phase: "agent-failed" }]);
  await assert.rejects(wakeHost(tb.call, { pause: 0 }), /failed to start twice[\s\S]*pass login timed out/);
  assert.deepEqual(tb.calls, ["host_wake", "agent_start", "host_wake", "host_wake", 'workspace_status {"name":"linear-agent"}']);
});
