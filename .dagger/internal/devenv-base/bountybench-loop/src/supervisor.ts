import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent } from "./run-agent.ts";
import { checkDaggerEngineVersion } from "./dagger-preflight.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.DEVENV_BASE_WORKSPACE_DIR ?? "/workspaces/devenv-base-gce";

// Same rationale as worker.ts: the supervisor also runs `dagger call
// bootstrap` (as its independent correctness check) against the host's
// shared Docker daemon, so it's just as exposed to a stale-engine mismatch.
checkDaggerEngineVersion();

// Same reasoning as worker.ts: a generous backstop, not a budget lever --
// this pass would rather take longer (or leave an environment for next
// hour) than cut off mid-review. Less directly grounded than the worker's
// figure since per-pass work scales with how many environments are
// pending, not a fixed per-app cost; set higher to cover a backlog of a
// few environments in one pass.
const MAX_TURNS = Number(process.env.BOUNTYBENCH_SUPERVISOR_MAX_TURNS ?? "200");
const AUTO_COMPACT_WINDOW = Number(process.env.BOUNTYBENCH_AUTO_COMPACT_WINDOW ?? "200000");

const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
if (!oauthToken) {
  throw new Error("missing required env var: CLAUDE_CODE_OAUTH_TOKEN");
}

const prompt = readFileSync(join(__dirname, "..", "prompts", "supervisor.md"), "utf8");

const result = await runAgent({
  prompt,
  oauthToken,
  cwd: WORKSPACE_DIR,
  // Supervisor operates on the host checkout (container-use CLI, `but`,
  // `dagger call bootstrap`, `restic`), not inside a container-use
  // environment -- so it needs Bash, not the container-use MCP tools. No
  // Write/Edit: CLAUDE.md's "Tracking and merging" section is explicit that
  // this pass verifies and integrates, it doesn't fix bugs in someone
  // else's environment, so the tool grant enforces that instead of prose.
  // Agent tool added so the supervisor can consult the "advisor" subagent
  // below (Opus) on ambiguous merge/conflict calls -- still Bash+Read only,
  // no Write/Edit, for the supervisor itself or the advisor it invokes.
  allowedTools: ["Bash", "Read", "Agent"],
  // See run-agent.ts's RunAgentOptions.disallowedTools doc comment: strips
  // the always-on server-side advisor tool so the model's only path to Opus
  // is the deliberate, gated `agents.advisor` subagent below.
  disallowedTools: ["advisor"],
  maxTurns: MAX_TURNS,
  autoCompactWindow: AUTO_COMPACT_WINDOW,
  // Main run: judgment calls (did the GitButler apply actually stay clean,
  // did bootstrap actually pass) warrant more than Haiku, but don't need
  // Opus by default -- that's reserved for the advisor consult below.
  model: "sonnet",
  agents: {
    advisor: {
      description:
        "Consult before merging when the GitButler integration check or the independent `dagger call bootstrap` re-run is ambiguous -- e.g. a conflict that might be a false positive, or a bootstrap failure that might be flaky/environmental rather than a real regression. Not for routine passes: only call when the merge/no-merge call genuinely isn't clear-cut.",
      tools: ["Bash", "Read"],
      model: "opus",
      prompt:
        "You are a second opinion on a bountybench-dagger-modules merge decision. You'll be given what the supervisor pass found (GitButler apply result, dagger call bootstrap output/exit status, and its own read of ambiguity). Investigate with Bash/Read as needed, then give a clear merge/don't-merge recommendation with your reasoning. You do not merge or push anything yourself -- report back only.",
    },
  },
  onActivity: (line) => console.log(line),
});

console.log("\n--- supervisor run result ---\n");
console.log(result);
