import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent } from "./run-agent.ts";
import { checkDaggerEngineVersion } from "./dagger-preflight.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = process.env.DEVENV_BASE_WORKSPACE_DIR ?? "/workspaces/devenv-base-gce";

// Fail fast, before any agent turns are spent, rather than let a worker
// mistake a stale-engine version mismatch for a bug in its own module (see
// dagger-preflight.ts for the incident this is grounded in).
checkDaggerEngineVersion();

// Derived from the one real data point we have: a restic-backed ~/.claude
// transcript showed gunicorn + django (two full modules) plus discussion
// overhead cost ~161 turns combined in one session -- call it ~80
// turns/app as a rough ceiling for a clean run. But the goal here isn't
// speed, it's the loop actually reaching a working Bootstrap + Serve --
// stopping a run early because it hit a tight turn cap just means a
// partial environment sits there until another worker run picks it up
// later, wasting the turns already spent. With autoCompactWindow keeping
// context bounded (below), there's no longer a context-exhaustion reason
// to cap tightly either. So this is set well above the ~80/app baseline --
// a backstop against a genuinely runaway/looping run, not a budget lever.
const MAX_TURNS = Number(process.env.BOUNTYBENCH_WORKER_MAX_TURNS ?? "300");
// ~20% of Sonnet 5's 1M-token context window (see run-agent.ts) -- compact
// often rather than risk running out of room mid-task.
const AUTO_COMPACT_WINDOW = Number(process.env.BOUNTYBENCH_AUTO_COMPACT_WINDOW ?? "200000");

const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
if (!oauthToken) {
  throw new Error("missing required env var: CLAUDE_CODE_OAUTH_TOKEN");
}

const prompt = readFileSync(join(__dirname, "..", "prompts", "worker.md"), "utf8");

const result = await runAgent({
  prompt,
  oauthToken,
  cwd: WORKSPACE_DIR,
  // Worker must never touch git or push directly -- only container-use's
  // own MCP tools, so its branch/commit history comes from ordinary
  // container-use use (CLAUDE.md step 7). No Bash, no Read/Write/Edit.
  allowedTools: ["mcp__container-use__*"],
  // See run-agent.ts's RunAgentOptions.disallowedTools doc comment: the
  // server-side advisor tool is available regardless of allowedTools, and
  // the worker should never be making judgment calls.
  disallowedTools: ["advisor"],
  maxTurns: MAX_TURNS,
  autoCompactWindow: AUTO_COMPACT_WINDOW,
  // Grunt work: the module skeleton is fully scripted in CLAUDE.md (fixed
  // steps, fixed shape per bountybench-dagger/main.go). Haiku is cheap and
  // sufficient for following that script; it's not making the judgment calls
  // (those are the supervisor's job).
  model: "haiku",
  // TEMPORARY: pinned to low effort per explicit instruction, until a
  // supervisor run confirms the new auto-remediating dagger-preflight
  // fix (checkDaggerEngineVersion) works correctly end-to-end. Revert
  // (drop this line) once that's confirmed.
  effort: "low",
  mcpServers: {
    "container-use": {
      type: "stdio",
      command: "sh",
      args: ["-c", `cd "${WORKSPACE_DIR}" && exec container-use stdio`],
      alwaysLoad: true,
      // No `env` override here on purpose: whatever the SDK puts in a
      // server's `env` gets embedded verbatim in the `claude` CLI's own
      // `--mcp-config` argv (confirmed live -- spreading `...process.env`
      // here put the full GCP service-account key and the OAuth token in
      // plaintext in `ps aux` output on this box, a real secret leak, not a
      // theoretical one). DOCKER_CONFIG (see run-agent.ts's
      // DOCKER_CONFIG_NO_CREDS_STORE comment) is not secret, but the lesson
      // generalizes: never put env vars here. This subprocess already
      // inherits DOCKER_CONFIG from the parent `claude` process's real OS
      // environment (set via Options.env in run-agent.ts, which does NOT
      // appear in argv), via ordinary child-process env inheritance -- no
      // per-server override needed.
    },
  },
  onActivity: (line) => console.log(line),
});

console.log("\n--- worker run result ---\n");
console.log(result);
