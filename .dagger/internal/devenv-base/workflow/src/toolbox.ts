// The toolbox (CIT-430) from a workflow task: the MCP server on Render that
// starts and stops the GCE host and ships the Linear agent's work. A task
// calls one tool at a time over MCP's streamable HTTP transport, the way
// Claude Code does, so host start/stop and ship need no model.
//
// Only the tools named here can be called. Deleting a workspace and the
// codespace tools stay with people.
import type { ShipJob } from "./apply.ts";

export const TASK_TOOLS = [
  "host_status",
  // Starts the host and steps until it is ready (CIT-466, #241); the toolbox
  // owns the host's lifecycle, idle stop and lease included.
  "host_wake",
  "host_start",
  "host_stop",
  "workspace_list",
  "workspace_status",
  // Retries the Linear agent once when host_wake reports its start failed.
  "agent_start",
  "agent_ship",
  "agent_ship_status",
  "codex_review",
  "codex_review_status",
] as const;

export type TaskTool = (typeof TASK_TOOLS)[number];

export const TOOLBOX_URL = "https://toolbox-spike.onrender.com/mcp";

interface RpcResponse {
  result?: { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };
  error?: { code: number; message: string };
}

// A response is JSON, or an event stream whose data lines carry the JSON.
async function readRpc(res: Response): Promise<RpcResponse> {
  const body = await res.text();
  if (!res.ok) throw new Error(`toolbox answered ${res.status}: ${body.slice(0, 500)}`);
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) return JSON.parse(body) as RpcResponse;
  const data = body
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (!data.length) throw new Error("toolbox sent an empty event stream");
  return JSON.parse(data[data.length - 1]!) as RpcResponse;
}

export interface ToolResult {
  text: string;
  structured?: unknown;
}

export function toolboxClient(token: string, url = TOOLBOX_URL, fetcher = fetch) {
  let session: string | undefined;
  let id = 0;
  const post = async (message: Record<string, unknown>) => {
    const res = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...message }),
    });
    session ??= res.headers.get("mcp-session-id") ?? undefined;
    return res;
  };
  const open = async () => {
    const init = await readRpc(
      await post({
        id: ++id,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "supervisor-workflow", version: "0" } },
      }),
    );
    if (init.error) throw new Error(`toolbox initialize failed: ${init.error.message}`);
    // A notification has no id, and its answer has no body.
    await post({ method: "notifications/initialized" });
  };

  return {
    async call(tool: TaskTool, args: Record<string, unknown> = {}): Promise<ToolResult> {
      if (!(TASK_TOOLS as readonly string[]).includes(tool)) throw new Error(`a workflow task may not call toolbox tool ${tool}`);
      if (!session) await open();
      const r = await readRpc(await post({ id: ++id, method: "tools/call", params: { name: tool, arguments: args } }));
      if (r.error) throw new Error(`toolbox ${tool} failed: ${r.error.message}`);
      const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
      if (r.result?.isError) throw new Error(`toolbox ${tool}: ${text}`);
      return { text, ...(r.result?.structuredContent !== undefined ? { structured: r.result.structuredContent } : {}) };
    },
  };
}

// host_wake moves the host one step per call, so it is called until the
// Linear agent's webhook answers. When the agent's start job failed, host_wake
// says so and stops there: retry it once with agent_start, and if it fails
// again, fail with its log so the cause is in the apply's error.
export async function wakeHost(
  call: (tool: TaskTool, args?: Record<string, unknown>) => Promise<ToolResult>,
  { timeout = 15 * 60_000, pause = 20_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  let retried = false;
  for (;;) {
    const r = await call("host_wake");
    const phase = (r.structured as { ready?: boolean; phase?: string } | undefined) ?? {};
    if (phase.ready) return;
    if (phase.phase === "agent-failed") {
      if (retried) {
        const log = await call("workspace_status", { name: "linear-agent" }).then((s) => s.text, (e: Error) => e.message);
        throw new Error(`the Linear agent failed to start twice: ${r.text}\n${log}`);
      }
      retried = true;
      await call("agent_start");
    }
    if (Date.now() > deadline) throw new Error(`the host was not ready after ${timeout / 60_000} minutes: ${r.text}`);
    await new Promise((done) => setTimeout(done, pause));
  }
}

// agent_ship_status's answer, as apply reads it. The environment is the one
// the host says it started (`request`), or the one a successful job pushed.
// An answer apply cannot read fails: guessing "idle" would start a second
// ship over a running one.
export function shipJob(text: string): ShipJob {
  const s = JSON.parse(text) as {
    job_running?: unknown; job_exit?: unknown;
    request?: { env?: unknown; branch?: unknown } | null; result?: { env?: unknown; branch?: unknown } | null;
    log_tail?: unknown;
  };
  if (typeof s.job_running !== "boolean" || !(s.job_exit === null || typeof s.job_exit === "number")) {
    throw new Error(`agent_ship_status gave no job state: ${text.slice(0, 300)}`);
  }
  const env = s.request?.env ?? s.result?.env;
  const branch = s.request?.branch ?? s.result?.branch;
  return {
    running: s.job_running, exit: s.job_exit,
    ...(typeof env === "string" ? { env } : {}),
    ...(typeof branch === "string" ? { branch } : {}),
    ...(typeof s.log_tail === "string" ? { log: s.log_tail } : {}),
  };
}
