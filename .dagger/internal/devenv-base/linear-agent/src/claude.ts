import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { worktreeGuard } from "./guard.ts";

/**
 * Runs a single Claude Agent SDK turn and returns its final text result.
 *
 * permissionMode is dontAsk: the SDK's headless query() has no human to
 * answer a permission prompt, so anything not pre-approved is denied instead
 * of hanging the turn. What is pre-approved depends on LINEAR_AGENT_SANDBOX:
 *
 * - worktree: the turn runs in the session's git worktree (see worktree.ts),
 *   with file tools and Bash; a PreToolUse hook (guard.ts) keeps every call
 *   inside that worktree. Pushing and opening the PR are done by the server
 *   after the turn.
 * - unset (e.g. the Render service, 512 MB and no repo): Claude answers from
 *   the Linear context in the prompt, with no tools.
 */
export type ActivityContent =
  | { type: "thought" | "response" | "error"; body: string }
  | { type: "action"; action: string; parameter: string };

const MAX_ACTIVITY_BODY = 2000;

function truncate(body: string): string {
  return body.length > MAX_ACTIVITY_BODY
    ? `${body.slice(0, MAX_ACTIVITY_BODY)}\n... [truncated]`
    : body;
}

// Tool inputs that are huge or redundant with the action itself (file
// contents, whole edits) -- narrated as just the path, instead of a
// multi-KB blob per call.
function describeToolInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "Write" || name === "Edit" || name === "Read") return String(i.file_path ?? "");
  if (name === "Bash") return truncate(String(i.command ?? ""));
  try {
    return truncate(JSON.stringify(input));
  } catch {
    return "";
  }
}

const NO_TOOLS_PROMPT =
  "You are running with no tools: you cannot read the repository, run commands, " +
  "or change code. Work from the Linear issue context in the prompt. Reply with " +
  "your analysis, questions, or a concrete plan, and say plainly what you would " +
  "need to check in the code instead of guessing.";

const WORKTREE_PROMPT =
  "You are working in a git worktree of the repository, on a branch made for this " +
  "Linear session; it is your current directory. Read and edit files here, run the " +
  "repository's scripts and tests to check your work, and commit with git when the " +
  "change is done (git add, git commit). Do not push: the server pushes your branch " +
  "and opens a pull request after your turn, and Codex reviews it.";

const WORKTREE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];

function sandboxOptions(cwd: string | undefined): Options {
  if (!cwd) {
    return {
      tools: [],
      settingSources: [],
      systemPrompt: { type: "preset", preset: "claude_code", append: NO_TOOLS_PROMPT },
    };
  }
  return {
    cwd,
    tools: WORKTREE_TOOLS,
    hooks: { PreToolUse: [{ hooks: [worktreeGuard(cwd)] }] },
    settingSources: [],
    systemPrompt: { type: "preset", preset: "claude_code", append: WORKTREE_PROMPT },
  };
}

/** cwd is the session's worktree in worktree mode, undefined otherwise. */
export async function runClaude(
  prompt: string,
  oauthToken: string,
  onActivity?: (content: ActivityContent) => void | Promise<void>,
  cwd?: string,
): Promise<string> {
  const result = query({
    prompt,
    options: {
      ...sandboxOptions(cwd),
      permissionMode: "dontAsk",
      env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: oauthToken },
      strictMcpConfig: true,
    },
  });

  for await (const message of result) {
    const done = await narrate(message, onActivity);
    if (done !== undefined) return done;
  }

  throw new Error("claude query ended without a result message");
}

/**
 * One message of a Claude turn -- an SDK message, or a line of the CLI's
 * `--output-format stream-json`, which has the same shape -- narrated as
 * Linear activities. Returns the turn's final text on a success result,
 * throws on a failed one, and returns undefined for everything else.
 */
export async function narrate(
  // Loosely typed: stream-json lines are parsed JSON, not SDK types.
  message: any,
  onActivity?: (content: ActivityContent) => void | Promise<void>,
): Promise<string | undefined> {
  if (message.type === "assistant" && onActivity) {
    for (const block of message.message?.content ?? []) {
      if (block.type === "text" && block.text) {
        await onActivity({ type: "thought", body: truncate(block.text) });
      } else if (block.type === "thinking" && block.thinking) {
        await onActivity({ type: "thought", body: truncate(block.thinking) });
      } else if (block.type === "tool_use") {
        await onActivity({ type: "action", action: block.name, parameter: describeToolInput(block.name, block.input) });
      }
    }
  } else if (message.type === "result") {
    if (message.subtype === "success") {
      return message.result;
    }
    throw new Error(`claude turn failed (${message.subtype}): ${(message.errors ?? []).join("; ")}`);
  }
  return undefined;
}
