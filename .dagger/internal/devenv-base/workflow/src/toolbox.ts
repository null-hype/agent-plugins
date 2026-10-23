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

// What a failed request says about whether the toolbox ran it:
// - "missing-session": it answered 404 to a request that carried a session
//   id. The Go MCP SDK does that before it runs any tool, so nothing ran.
// - "ambiguous": no answer, a 5xx, or an answer cut off. The tool may have run.
// - "definitive": the toolbox answered and refused.
type Outcome = "missing-session" | "ambiguous" | "definitive";

class ToolboxError extends Error {
  outcome: Outcome;
  constructor(message: string, outcome: Outcome) {
    super(message);
    this.outcome = outcome;
  }
}

// A response is JSON, or an event stream whose data lines carry the JSON.
async function readRpc(res: Response, sentSession: boolean): Promise<RpcResponse> {
  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    throw new ToolboxError(`toolbox answer was cut off: ${(e as Error).message}`, "ambiguous");
  }
  if (!res.ok) {
    const outcome: Outcome = res.status === 404 && sentSession ? "missing-session" : res.status >= 500 ? "ambiguous" : "definitive";
    throw new ToolboxError(`toolbox answered ${res.status}: ${body.slice(0, 500)}`, outcome);
  }
  const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  const data = isStream
    ? body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter(Boolean)
    : [body];
  if (!data.length) throw new ToolboxError("toolbox sent an empty event stream", "ambiguous");
  try {
    return JSON.parse(data[data.length - 1]!) as RpcResponse;
  } catch {
    throw new ToolboxError(`toolbox sent an answer that is not JSON: ${body.slice(0, 200)}`, "ambiguous");
  }
}

export interface ToolResult {
  text: string;
  structured?: unknown;
}

// A session the toolbox no longer knows (it was redeployed, CIT-524) is
// opened again, this many times per call at most.
export const MAX_REOPENS = 2;

// Tools that read, or step the host toward a state (host_wake). Every other
// tool has an effect: when its answer never arrives the error says its outcome
// is unknown, and nothing sends it again. After a lost session (a 404, so the
// tool never ran) the effect tools are sent again; the host refuses a second
// codex_review while one runs and skips a head it reviewed, and agent_ship is
// checked against agent_ship_status first.
const NO_EFFECT: readonly TaskTool[] = ["host_status", "host_wake", "workspace_list", "workspace_status", "agent_ship_status", "codex_review_status"];

export function toolboxClient(token: string, url = TOOLBOX_URL, fetcher = fetch) {
  let session: string | undefined;
  let id = 0;
  const post = async (message: Record<string, unknown>) => {
    const sent = session;
    let res: Response;
    try {
      res = await fetcher(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          ...(sent ? { "Mcp-Session-Id": sent } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
      });
    } catch (e) {
      throw new ToolboxError(`toolbox did not answer: ${(e as Error).message}`, "ambiguous");
    }
    session ??= res.headers.get("mcp-session-id") ?? undefined;
    return { res, sent: sent !== undefined };
  };
  const rpc = async (message: Record<string, unknown>) => {
    const { res, sent } = await post(message);
    return readRpc(res, sent);
  };
  const open = async () => {
    const init = await rpc({
      id: ++id,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "supervisor-workflow", version: "0" } },
    });
    if (init.error) throw new ToolboxError(`toolbox initialize failed: ${init.error.message}`, "definitive");
    // A notification has no id, and its answer has no body.
    const { res, sent } = await post({ method: "notifications/initialized" });
    if (!res.ok) await readRpc(res, sent);
  };
  const invoke = async (tool: TaskTool, args: Record<string, unknown>): Promise<ToolResult> => {
    let r: RpcResponse;
    try {
      r = await rpc({ id: ++id, method: "tools/call", params: { name: tool, arguments: args } });
    } catch (e) {
      if (e instanceof ToolboxError && e.outcome === "ambiguous" && !NO_EFFECT.includes(tool)) {
        throw new Error(`toolbox ${tool}: outcome unknown, not called again (${e.message}); check what it did before repeating it`);
      }
      throw e;
    }
    if (r.error) throw new Error(`toolbox ${tool} failed: ${r.error.message}`);
    const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    if (r.result?.isError) throw new Error(`toolbox ${tool}: ${text}`);
    return { text, ...(r.result?.structuredContent !== undefined ? { structured: r.result.structuredContent } : {}) };
  };
  // Before agent_ship is sent again in a new session, the host says whether
  // a ship job for this environment is already running. The host runs one
  // ship at a time, so that job is this call's work, done by an earlier call.
  const shipHeld = async (args: Record<string, unknown>): Promise<ToolResult | undefined> => {
    const status = await invoke("agent_ship_status", {});
    const job = shipJob(status.text);
    if (!job.running || job.env !== args.env) return undefined;
    return {
      text: `agent_ship not sent again: the host's ship job for ${String(args.env)} is already running. ${status.text}`,
      ...(status.structured !== undefined ? { structured: status.structured } : {}),
    };
  };

  return {
    async call(tool: TaskTool, args: Record<string, unknown> = {}): Promise<ToolResult> {
      if (!(TASK_TOOLS as readonly string[]).includes(tool)) throw new Error(`a workflow task may not call toolbox tool ${tool}`);
      let reopened = 0;
      for (;;) {
        try {
          if (!session) await open();
          if (reopened && tool === "agent_ship") {
            const held = await shipHeld(args);
            if (held) return held;
          }
          return await invoke(tool, args);
        } catch (e) {
          if (!(e instanceof ToolboxError) || e.outcome !== "missing-session") throw e;
          if (reopened >= MAX_REOPENS) {
            throw new Error(`toolbox ${tool}: the session was lost again after ${MAX_REOPENS} reopenings, giving up (${e.message})`);
          }
          reopened++;
          session = undefined;
        }
      }
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
