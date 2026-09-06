import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query, type AgentDefinition, type Options } from "@anthropic-ai/claude-agent-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ~/.docker/config.json on this box sets `credsStore: "devpod"`, a helper
// that proxies credential lookups to a local port devpod only forwards when
// a workspace is interactively attached (VS Code / `devpod ssh`). In this
// headless/cron context nothing is listening there, so the helper call
// fails -- and unlike the plain `docker` CLI (which tolerates that and falls
// back to an anonymous pull), dagger/buildkit's client-side auth provider
// treats the failed credential lookup as fatal, even for a public image that
// needs no auth at all (confirmed live: `dagger call bootstrap --help`
// failed with "failed to get credentials: EOF" under the ambient config, and
// succeeded once DOCKER_CONFIG pointed at a credsStore-less config instead).
// This repo-tracked config (`{"auths": {}}`, no secrets) sidesteps the
// helper entirely so pulls of the public base images bountybench-dagger-*
// modules use go through as plain anonymous pulls.
export const DOCKER_CONFIG_NO_CREDS_STORE = join(__dirname, "..", "..", ".devcontainer", "docker-config-noauth");

/**
 * Runs one Claude Agent SDK turn to completion and returns its final text
 * result. This is the enforcement point the bountybench-dagger worker and
 * supervisor prompts rely on: maxTurns and allowedTools are passed straight
 * through to the SDK's query(), which stops the loop itself (a "result"
 * message with subtype !== "success") rather than depending on the model
 * choosing to respect a budget written into the prompt text. See
 * ../../linear-agent/src/claude.ts's runClaude for the pattern this is
 * lifted from (permissionMode/strictMcpConfig/cwd rationale documented
 * there); duplicated rather than imported since these are two independent
 * packages, same as this repo's bountybench-dagger-* Go modules each carry
 * their own go.mod instead of sharing one.
 */
export interface RunAgentOptions {
  prompt: string;
  oauthToken: string;
  cwd: string;
  allowedTools: string[];
  maxTurns: number;
  /**
   * Model alias ('sonnet', 'opus', 'haiku') or full model ID for the main
   * run. Left undefined falls back to the CLI default. Worker runs pass
   * 'haiku' (mechanical, scripted-in-CLAUDE.md grunt work); supervisor runs
   * pass 'sonnet' (judgment calls: does GitButler apply cleanly, did
   * bootstrap actually pass).
   */
  model?: string;
  /**
   * Reasoning effort level ('low' | 'medium' | 'high' | 'xhigh' | 'max').
   * Left undefined falls back to the CLI default.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * Named subagents the main run can invoke via the Agent tool. Used for the
   * supervisor's Opus advisor -- consulted on ambiguous merge/conflict calls,
   * not run as the primary model (see prompts/supervisor.md).
   */
  agents?: Record<string, AgentDefinition>;
  /**
   * Token count autocompact measures usage against (Options.settings.
   * autoCompactWindow) -- NOT a percentage in the SDK's own terms, but the
   * caller picks it as a fraction of the model's real context window (see
   * worker.ts/supervisor.ts: 200_000 = ~20% of Sonnet 5's 1M window).
   * Smaller than the model's real limit means compaction triggers earlier,
   * which is the point for an unattended loop that would rather compact
   * often and keep running than run out of room mid-task.
   */
  autoCompactWindow: number;
  /**
   * Tools to strip from the model's context entirely, including
   * harness-internal ones that `allowedTools`/`tools` can't reach (see the
   * SDK's own doc comment on `disallowedTools`). Both callers pass
   * `["advisor"]`: the server-side advisor tool is enabled ambiently via
   * this host's ~/.claude/settings.json (`advisorModel`), independent of
   * allowedTools -- confirmed live, a worker run called it despite
   * allowedTools listing only mcp__container-use__*, and the run then
   * crashed with an SDK-level `error_during_execution` right after the
   * advisor_tool_result content block (a stop_reason=end_turn misclassified
   * as an error -- see ede_diagnostic in that run's result message). Worker
   * has no business consulting an advisor at all (CLAUDE.md: no judgment
   * calls); supervisor's escalation path is its own gated `agents.advisor`
   * subagent below, not this always-on tool.
   */
  disallowedTools?: string[];
  mcpServers?: Options["mcpServers"];
  onActivity?: (line: string) => void;
}

export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const result = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      permissionMode: "dontAsk",
      allowedTools: opts.allowedTools,
      ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
      // `allowedTools` alone only auto-approves -- it does NOT restrict which
      // tools are available (confirmed live: the worker successfully called
      // Read/Bash despite allowedTools listing only mcp__container-use__*).
      // `tools` is the SDK's actual availability gate (sdk.d.ts: "Specify the
      // base set of available built-in tools" / "[] -- Disable all built-in
      // tools"); it only governs built-ins, so passing the same list here
      // disables every built-in not named in it while leaving the MCP tools
      // wired in via mcpServers untouched. Reusing opts.allowedTools works
      // for both callers: the worker's ["mcp__container-use__*"] matches no
      // built-in name (so all built-ins are disabled, MCP tools still work),
      // and the supervisor's ["Bash", "Read", "Agent"] names exactly the
      // built-ins it should have.
      tools: opts.allowedTools,
      maxTurns: opts.maxTurns,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(opts.agents ? { agents: opts.agents } : {}),
      settings: {
        autoCompactEnabled: true,
        autoCompactWindow: opts.autoCompactWindow,
      },
      // DOCKER_CONFIG here covers the supervisor's own Bash-tool re-run of
      // `dagger call bootstrap` (see comment above the constant).
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken,
        DOCKER_CONFIG: DOCKER_CONFIG_NO_CREDS_STORE,
      },
      ...(opts.mcpServers
        ? { mcpServers: opts.mcpServers, strictMcpConfig: true }
        : {}),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
    },
  });

  for await (const message of result) {
    if (message.type === "assistant" && opts.onActivity) {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          opts.onActivity(`[thought] ${block.text}`);
        } else if (block.type === "tool_use") {
          opts.onActivity(`[action] ${block.name}(${JSON.stringify(block.input)})`);
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        return message.result;
      }
      // Includes the max-turns case: query() stops the loop itself and
      // reports a non-"success" subtype instead of the model choosing to
      // stop, which is the whole point of enforcing the budget here rather
      // than in prompt text.
      throw new Error(`agent run did not complete (${message.subtype}): ${JSON.stringify(message)}`);
    }
  }

  throw new Error("agent query ended without a result message");
}
