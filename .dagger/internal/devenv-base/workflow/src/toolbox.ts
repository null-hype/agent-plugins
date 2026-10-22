// The toolbox (CIT-430) from a workflow task: the MCP server on Render that
// starts and stops the GCE host and ships the Linear agent's work. A task
// calls one tool at a time over MCP's streamable HTTP transport, the way
// Claude Code does, so host start/stop and ship need no model.
//
// Only the tools named here can be called. Deleting a workspace and the
// codespace tools stay with people.
export const TASK_TOOLS = [
  "host_status",
  // Starts the host and steps until it is ready (CIT-466, #241); the toolbox
  // owns the host's lifecycle, idle stop and lease included.
  "host_wake",
  "host_start",
  "host_stop",
  "workspace_list",
  "workspace_status",
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
