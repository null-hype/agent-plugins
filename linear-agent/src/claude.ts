import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * Runs a single Claude Agent SDK turn and returns its final text result.
 *
 * permissionMode is dontAsk: the SDK's headless query() has no human to
 * answer a permission prompt, and 'default' would just hang a turn forever
 * waiting for one. dontAsk denies anything not pre-approved instead of
 * hanging, so allowedTools explicitly pre-approves the container-use MCP
 * tools; the built-in filesystem/shell tools (Bash, Read, Write, Edit, Glob,
 * Grep, NotebookEdit) are disallowed outright on top of that — whatever
 * host this process is running on (a dev box, a prod devpod) must not be
 * directly reachable by a delegated issue. Instead the only file/code/shell
 * surface is the container-use MCP server (`container-use stdio`), which
 * does all such work inside an isolated per-task container/branch.
 * strictMcpConfig keeps that the *only* MCP server available too, ignoring
 * whatever .mcp.json or user-level MCP config happens to exist on the host.
 *
 * options.cwd is what actually matters here, and was missing before: it's
 * what the SDK reports to Claude as its own session directory ("Primary
 * working directory" / "Is a git repository" in the claude_code preset
 * system prompt), and Claude in turn passes that straight through as
 * environment_create's `environment_source` argument. Confirmed live by
 * hand-driving container-use's MCP stdio protocol directly: calling
 * environment_create with environment_source:"/app" reproduces "unable to
 * open repository: you must be in a git repository" verbatim, while
 * environment_source:"." (i.e. this process's real cwd) passes the git
 * check. Without options.cwd set, it defaults to process.cwd(), which is
 * /app -- start-linear-agent.sh cds there before launching node, since
 * /app is baked into the image and has no .git. The earlier fix (JIN-40)
 * only cd'd the container-use *subprocess*'s shell before exec'ing it,
 * which changes where the MCP server itself starts but not what cwd
 * Claude is told or what environment_source it sends -- the server's own
 * cwd was never actually consulted by environment_create, so that fix did
 * nothing for this failure. Kept anyway (harmless) as a fallback for calls
 * that omit environment_source or pass ".". /workspaces/devenv-base-gce is
 * the real devpod-cloned checkout (matches devcontainer.json's
 * workspaceFolder), hardcoded here since it's fixed for this deployment.
 * Diagnosed live in the JIN-40 and JIN-57/58 agent sessions.
 */
export type ActivityContent = { type: string; body: string };

const MAX_ACTIVITY_BODY = 2000;

function truncate(body: string): string {
  return body.length > MAX_ACTIVITY_BODY
    ? `${body.slice(0, MAX_ACTIVITY_BODY)}\n... [truncated]`
    : body;
}

// Tool inputs/outputs that are either huge or redundant with the action
// name itself (file contents, whole diffs) — narrated as just the tool
// name with no argument dump, instead of a multi-KB blob per call.
const NOISY_TOOLS = new Set([
  "mcp__container-use__environment_file_write",
  "mcp__container-use__environment_file_edit",
  "mcp__container-use__environment_file_read",
]);

function describeToolUse(name: string, input: unknown): string {
  if (NOISY_TOOLS.has(name)) return name;
  try {
    return `${name}(${truncate(JSON.stringify(input))})`;
  } catch {
    return name;
  }
}

export async function runClaude(
  prompt: string,
  oauthToken: string,
  onActivity?: (content: ActivityContent) => void | Promise<void>,
): Promise<string> {
  const result = query({
    prompt,
    options: {
      cwd: "/workspaces/devenv-base-gce",
      permissionMode: "dontAsk",
      allowedTools: ["mcp__container-use__*"],
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: oauthToken },
      mcpServers: {
        "container-use": {
          type: "stdio",
          command: "sh",
          args: [
            "-c",
            `cd "/workspaces/devenv-base-gce" && exec container-use stdio`,
          ],
          // Without this, tools are deferred behind tool search by default
          // and aren't guaranteed present in the turn-1 prompt -- observed
          // live as a turn that narrated "I've kicked off an exploration"
          // without ever actually calling an environment_* tool, since
          // Bash/Read/etc are disallowed and container-use was the only
          // other way to look at anything.
          alwaysLoad: true,
        },
      },
      strictMcpConfig: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
    },
  });

  for await (const message of result) {
    if (message.type === "assistant" && onActivity) {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          await onActivity({ type: "thought", body: truncate(block.text) });
        } else if (block.type === "thinking" && block.thinking) {
          await onActivity({ type: "thought", body: truncate(block.thinking) });
        } else if (block.type === "tool_use") {
          await onActivity({ type: "action", body: describeToolUse(block.name, block.input) });
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        return message.result;
      }
      throw new Error(`claude turn failed (${message.subtype}): ${message.errors.join("; ")}`);
    }
  }

  throw new Error("claude query ended without a result message");
}
