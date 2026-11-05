// What session.ts needs from whatever model does the work: one turn, from a
// prompt to its final text, narrating as it goes. claude.ts (the Claude Agent
// SDK) and openrouter.ts (@openrouter/agent) each provide one, and the
// server picks which from AGENT_RUNTIME, so the Linear side -- webhooks,
// OAuth, sessions, claims -- is one implementation for both agents.
export type ActivityContent = { type: string; body: string };

export type AgentRunner = (
  prompt: string,
  onActivity?: (content: ActivityContent) => void | Promise<void>,
) => Promise<string>;

const MAX_ACTIVITY_BODY = 2000;

export function truncate(body: string): string {
  return body.length > MAX_ACTIVITY_BODY
    ? `${body.slice(0, MAX_ACTIVITY_BODY)}\n... [truncated]`
    : body;
}

// Tool inputs/outputs that are either huge or redundant with the action
// name itself (file contents, whole diffs) — narrated as just the tool
// name with no argument dump, instead of a multi-KB blob per call. Both
// runners see the container-use tools; Claude prefixes them with the MCP
// server's name, the OpenRouter runner does not.
const NOISY_TOOLS = new Set([
  "environment_file_write",
  "environment_file_edit",
  "environment_file_read",
]);

export function describeToolUse(name: string, input: unknown): string {
  if (NOISY_TOOLS.has(name.replace(/^mcp__container-use__/, ""))) return name;
  try {
    return `${name}(${truncate(typeof input === "string" ? input : JSON.stringify(input))})`;
  } catch {
    return name;
  }
}

// How work gets written, said up front (CIT-523). Without it the agent met
// a denied Edit on the host, read the denial as the maintainer's boundary,
// and stopped to ask for edit permission instead of using the environment
// it is meant to use (CIT-463 on 2026-10-22, CIT-524 on 2026-10-23). The
// second paragraph holds for every runtime; the first is Claude's, whose
// preset has host tools that are denied.
export const SHIP_CONTRACT = `When the work is done, say so on the issue and name the environment id (like \`amazed-bluebird\`). The supervisor ships it to the issue's branch and opens the pull request; you cannot push. Ask the maintainer only about what no environment can settle, such as spending money or changing a hosted service's settings, and carry on with everything else.`;
