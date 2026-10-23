import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REOPENS, toolboxClient, wakeHost, type TaskTool, type ToolResult } from "./toolbox.ts";

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

// A toolbox that keeps its sessions in memory, the way the Go server does:
// a request in a session it does not know gets 404 before any tool runs.
// `lose()` is a redeploy. `ran` is every tool the server executed.
function sessionToolbox(tools: Partial<Record<TaskTool, () => string>>, { afterRun }: { afterRun?: (tool: string) => Response | Error | undefined } = {}) {
  const sessions = new Set<string>();
  const sent: string[] = [];
  const ran: string[] = [];
  let opened = 0;
  const fetcher = (async (_url: string, init: RequestInit) => {
    const msg = JSON.parse(init.body as string);
    const sid = new Headers(init.headers).get("mcp-session-id");
    const name: string = msg.params?.name;
    sent.push(msg.method === "tools/call" ? `tools/call ${name}` : msg.method);
    if (msg.method === "initialize") {
      const s = `s-${++opened}`;
      sessions.add(s);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }), { headers: { "content-type": "application/json", "mcp-session-id": s } });
    }
    if (!sid || !sessions.has(sid)) return new Response("session not found\n", { status: 404 });
    if (!("id" in msg)) return new Response(null, { status: 202 });
    ran.push(name);
    const after = afterRun?.(name);
    if (after instanceof Error) throw after;
    if (after) return after;
    const body = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: tools[name as TaskTool]?.() ?? "ok" }] } };
    return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetcher, sent, ran, lose: () => sessions.clear(), opened: () => opened };
}

const idle = JSON.stringify({ job_running: false, job_exit: null });
const shipping = (env: string) => JSON.stringify({ job_running: true, job_exit: null, request: { env, branch: "cit-1-x" } });

test("a session the toolbox lost between calls is opened again, and the call goes through", async () => {
  const tb = sessionToolbox({ host_status: () => "the host is up" });
  const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
  await client.call("host_status");
  tb.lose();
  assert.deepEqual(await client.call("host_status"), { text: "the host is up" });
  assert.deepEqual(tb.sent, [
    "initialize", "notifications/initialized", "tools/call host_status",
    "tools/call host_status", "initialize", "notifications/initialized", "tools/call host_status",
  ]);
  assert.equal(tb.opened(), 2);
  // The new session is kept: the next call does not open another.
  await client.call("host_status");
  assert.equal(tb.opened(), 2);
});

test("a toolbox that keeps losing the session is reopened a bounded number of times, then the call fails", async () => {
  const tb = sessionToolbox({});
  const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
  await client.call("host_status");
  // Every new session is gone before its first call.
  const open = tb.fetcher;
  const gone = ((url: string, init: RequestInit) => {
    const r = open(url, init);
    if (JSON.parse(init.body as string).method === "notifications/initialized") tb.lose();
    return r;
  }) as typeof fetch;
  const stuck = toolboxClient("tok", "https://toolbox/mcp", gone);
  await assert.rejects(stuck.call("host_status"), new RegExp(`lost again after ${MAX_REOPENS} reopenings`));
  assert.equal(tb.sent.filter((m) => m === "initialize").length, 1 + MAX_REOPENS + 1);
  assert.equal(tb.ran.filter((n) => n === "host_status").length, 1);
});

test("agent_ship is not sent again in a new session when the host is already shipping that environment", async () => {
  const tb = sessionToolbox({ agent_ship_status: () => shipping("trusty-burro") });
  const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
  await client.call("host_status");
  tb.lose();
  const r = await client.call("agent_ship", { env: "trusty-burro", branch: "cit-1-x" });
  assert.match(r.text, /agent_ship not sent again[\s\S]*trusty-burro/);
  assert.deepEqual(tb.ran, ["host_status", "agent_ship_status"]);
});

test("agent_ship is sent once in a new session when the host is not shipping that environment", async () => {
  for (const status of [idle, shipping("other-env")]) {
    const tb = sessionToolbox({ agent_ship_status: () => status, agent_ship: () => "shipping started" });
    const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
    await client.call("host_status");
    tb.lose();
    assert.deepEqual(await client.call("agent_ship", { env: "trusty-burro", branch: "cit-1-x" }), { text: "shipping started" });
    assert.deepEqual(tb.ran, ["host_status", "agent_ship_status", "agent_ship"]);
  }
});

test("agent_ship is not sent again when the host's status cannot be read", async () => {
  const tb = sessionToolbox({ agent_ship_status: () => "not json at all" });
  const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
  await client.call("host_status");
  tb.lose();
  await assert.rejects(client.call("agent_ship", { env: "trusty-burro", branch: "cit-1-x" }));
  assert.ok(!tb.ran.includes("agent_ship"));
});

test("a side effect whose answer never arrived is not sent again", async () => {
  const failures: [string, (tool: string) => Response | Error | undefined][] = [
    ["the connection drops", (tool) => (tool === "agent_ship" ? new TypeError("fetch failed") : undefined)],
    ["a 503", (tool) => (tool === "agent_ship" ? new Response("unavailable", { status: 503 }) : undefined)],
    ["the stream is empty", (tool) => (tool === "agent_ship" ? new Response("event: message\n\n", { headers: { "content-type": "text/event-stream" } }) : undefined)],
  ];
  for (const [, afterRun] of failures) {
    const tb = sessionToolbox({}, { afterRun });
    const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
    await assert.rejects(client.call("agent_ship", { env: "trusty-burro", branch: "cit-1-x" }), /agent_ship: outcome unknown, not called again/);
    assert.deepEqual(tb.ran, ["agent_ship"]);
    assert.equal(tb.opened(), 1);
  }
});

test("a read whose answer never arrived is reported as it failed, not as an unknown outcome", async () => {
  const tb = sessionToolbox({}, { afterRun: () => new Response("unavailable", { status: 503 }) });
  const client = toolboxClient("tok", "https://toolbox/mcp", tb.fetcher);
  await assert.rejects(client.call("host_status"), /toolbox answered 503/);
});

test("a 404 on the first request, which carried no session, is not retried", async () => {
  let posts = 0;
  const fetcher = (async () => {
    posts++;
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  await assert.rejects(toolboxClient("tok", "https://toolbox/mcp", fetcher).call("host_status"), /toolbox answered 404/);
  assert.equal(posts, 1);
});
