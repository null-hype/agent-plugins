import { callModel, maxCost, stepCountIs, tool } from "@openrouter/agent";
import { convertMcpInputSchema } from "@openrouter/agent/mcp";
import { OpenRouter } from "@openrouter/agent/openrouter";
import type { Tool } from "@openrouter/agent/tool-types";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { WORKSPACE_DIR } from "./claude.ts";
import type { OpenRouterConfig } from "./config.ts";
import { resolveModel } from "./models.ts";
import { describeToolUse, SHIP_CONTRACT, truncate, type ActivityContent, type AgentRunner } from "./runner.ts";

/**
 * The OpenRouter runtime's turn: the same job as runClaude, with an
 * open-weight model on OpenRouter driving @openrouter/agent's tool loop.
 *
 * The tool surface is the same as Claude's and only that: the container-use
 * MCP server (`container-use stdio`, started in the workspace checkout for
 * the turn and stopped after it), so every file, shell and git operation
 * happens in an isolated per-task container and branch, never on the host.
 * There are no host tools at all here -- unlike the Claude Code preset,
 * nothing has to be denied. @openrouter/agent/mcp only connects to remote
 * (HTTP) MCP servers, so the stdio server is bridged here with the MCP
 * client and @openrouter/agent's own schema conversion.
 *
 * Tools run one at a time: several container-use calls on one environment
 * in parallel would race on its files. Each turn is bounded by
 * OPENROUTER_MAX_STEPS model calls and OPENROUTER_MAX_COST_USD dollars;
 * when either is reached the agent is asked for a final answer with tool
 * calls forbidden, so the session still gets a response.
 *
 * A running `container-use stdio` is also what the host's lifecycle counts
 * as this agent working an issue (host-lifecycle.sh), the way it counts the
 * Claude runtime's claude-agent-sdk process, so the host is not stopped
 * mid-turn.
 */
export function openRouterRunner(cfg: OpenRouterConfig): AgentRunner {
  const client = new OpenRouter({ apiKey: cfg.apiKey });
  return async (prompt, onActivity) => {
    const model = await resolveModel(cfg.model, cfg.apiKey);
    const mcp = await connectContainerUse();
    try {
      const result = callModel(client, {
        model,
        instructions: instructions(WORKSPACE_DIR),
        input: prompt,
        tools: mcp.tools,
        toolConcurrency: 1,
        toolTimeoutMs: TOOL_TIMEOUT_MS,
        stopWhen: [stepCountIs(cfg.maxSteps), maxCost(cfg.maxCostUsd)],
        onTurnEnd: async (_context, response) => {
          if (!onActivity) return;
          for (const content of narrate((response as { output?: unknown }).output)) {
            await onActivity(content);
          }
        },
      });
      const text = await result.getText();
      const usage = await result.getUsage();
      console.log(
        `openrouter: ${model} turn done: ${usage.modelCalls} calls, ${usage.totalTokens} tokens` +
          (usage.cost !== undefined ? `, $${usage.cost.toFixed(4)}` : ""),
      );
      if (!text.trim()) throw new Error(`${model} ended the turn without a response`);
      return text;
    } finally {
      await mcp.close();
    }
  };
}

/**
 * The system prompt. Claude gets its working directory from the Claude Code
 * preset and passes it to environment_create on its own (see claude.ts);
 * here nothing does, so the prompt says it.
 */
export function instructions(workspaceDir: string): string {
  return `You are a software engineer working a Linear issue that was delegated to you. Your messages are posted to the issue's agent session, where the maintainer reads them.

## How you change code here

The repository is checked out at ${workspaceDir}. You cannot touch it directly: your only tools are the container-use environment_* tools. Create an environment with environment_create, passing environment_source "${workspaceDir}" (and from_git_ref when you are told the issue has a branch), then read, change and test the code with the other environment_* tools, and commit it there. That is the intended path, not a workaround. Do not ask for other tools.

${SHIP_CONTRACT}

Be brief. When you finish, reply with what you did, the environment id, and anything the maintainer has to decide.`;
}

// A container-use command (a build, a test run) can take many minutes; the
// MCP client's default request timeout is one minute.
const TOOL_TIMEOUT_MS = 20 * 60 * 1000;

interface McpTools {
  tools: Tool[];
  close(): Promise<void>;
}

export async function connectContainerUse(): Promise<McpTools> {
  const transport = new StdioClientTransport({
    command: "sh",
    args: ["-c", `cd "${WORKSPACE_DIR}" && exec container-use stdio`],
    env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    stderr: "inherit",
  });
  const mcp = new Client({ name: "linear-agent-openrouter", version: "0.0.0" });
  await mcp.connect(transport);
  try {
    const defs: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    do {
      const page = await mcp.listTools(cursor ? { cursor } : undefined);
      defs.push(...(page.tools as typeof defs));
      cursor = page.nextCursor;
    } while (cursor);
    const tools = defs.map((def) =>
      tool({
        name: def.name,
        ...(def.description !== undefined && { description: def.description }),
        inputSchema: convertMcpInputSchema(def.inputSchema),
        execute: async (args: Record<string, unknown>) => {
          const res = await mcp.callTool({ name: def.name, arguments: args }, { timeout: TOOL_TIMEOUT_MS });
          return toolResultText(res);
        },
      }),
    ) as Tool[];
    return { tools, close: () => mcp.close().catch(() => undefined) };
  } catch (err) {
    await mcp.close().catch(() => undefined);
    throw err;
  }
}

/**
 * An MCP tool result as the text the model reads back. Errors stay visible
 * as errors, so the model can correct the call instead of taking a failed
 * command's output as success.
 */
export function toolResultText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: unknown };
  const parts = (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content omitted]`));
  if (parts.length === 0 && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  const text = parts.join("\n");
  return r.isError ? `Error: ${text}` : text;
}

/**
 * The model's output items of one round as session activities: what it
 * said and reasoned as thoughts, each tool call as an action -- the same
 * narration runClaude posts.
 */
export function narrate(output: unknown): ActivityContent[] {
  const out: ActivityContent[] = [];
  for (const item of Array.isArray(output) ? output : []) {
    const it = item as {
      type?: string;
      name?: string;
      arguments?: unknown;
      content?: Array<{ type?: string; text?: string }>;
      summary?: Array<{ text?: string }>;
    };
    if (it.type === "message") {
      const text = (it.content ?? []).map((c) => c.text ?? "").join("").trim();
      if (text) out.push({ type: "thought", body: truncate(text) });
    } else if (it.type === "reasoning") {
      const text = (it.summary ?? []).map((s) => s.text ?? "").join("\n").trim();
      if (text) out.push({ type: "thought", body: truncate(text) });
    } else if (it.type === "function_call" && it.name) {
      let args = it.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          // keep the raw string
        }
      }
      out.push({ type: "action", body: describeToolUse(it.name, args) });
    }
  }
  return out;
}
