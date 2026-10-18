import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { narrate, type ActivityContent } from "./claude.ts";

const run = promisify(execFile);

/**
 * LINEAR_AGENT_SANDBOX=codespace: each agent session gets its own GitHub
 * codespace of LINEAR_AGENT_CODESPACE_REPO, named agent-<session> so it is
 * found again by listing -- a server restart loses nothing. The Claude
 * session inside it is the agent session's own id (--session-id on the
 * first turn, --resume after), so no mapping is stored either.
 *
 * Credentials come from this server, which has them from Proton Pass
 * (linear-agent.env): gh uses its GH_TOKEN, and each turn sends the Claude
 * token to the codespace as the first line of stdin, so the codespace needs
 * no secrets of its own. Claude commits there but cannot push: each turn
 * points origin's push URL nowhere first. --idle-timeout stops a forgotten
 * codespace.
 */
const REPO = process.env.LINEAR_AGENT_CODESPACE_REPO ?? "null-hype/agent-plugins";
const BRANCH = process.env.LINEAR_AGENT_CODESPACE_BRANCH ?? "main";
const MACHINE = process.env.LINEAR_AGENT_CODESPACE_MACHINE ?? "basicLinux32gb";
const DEVCONTAINER = process.env.LINEAR_AGENT_CODESPACE_DEVCONTAINER ?? ".devcontainer/devcontainer.json";
const IDLE_TIMEOUT = process.env.LINEAR_AGENT_CODESPACE_IDLE_TIMEOUT ?? "30m";
const WORKSPACE = `/workspaces/${REPO.split("/")[1]}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CODESPACE_PROMPT =
  "You are working in a GitHub codespace of the repository, made for this Linear " +
  "session; your current directory is its checkout. Read and edit files, run the " +
  "repository's scripts and tests to check your work, and commit with git when the " +
  "change is done. Do not push and do not open pull requests.";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function displayName(agentSessionId: string): string {
  return `agent-${agentSessionId.slice(0, 8)}`;
}

/** The session's codespace name, creating the codespace on first use. */
export async function prepare(agentSessionId: string): Promise<string> {
  const { stdout } = await run("gh", ["cs", "list", "-R", REPO, "--json", "name,displayName"]);
  const existing = (JSON.parse(stdout || "[]") as { name: string; displayName: string }[]).find(
    (cs) => cs.displayName === displayName(agentSessionId),
  );
  if (existing) return existing.name;
  const { stdout: created } = await run("gh", [
    "cs", "create", "-R", REPO, "-b", BRANCH, "-m", MACHINE,
    "--devcontainer-path", DEVCONTAINER, "--display-name", displayName(agentSessionId),
    "--idle-timeout", IDLE_TIMEOUT, "--default-permissions",
  ]);
  return created.trim().split("\n").pop()!;
}

/**
 * Runs one headless Claude turn in the codespace and returns its final
 * text. The token and the prompt -- untrusted issue text -- go over stdin;
 * the remote command line holds only fixed strings and the (validated)
 * session id.
 */
export function runClaude(
  codespace: string,
  agentSessionId: string,
  resume: boolean,
  prompt: string,
  oauthToken: string,
  onActivity?: (content: ActivityContent) => void | Promise<void>,
): Promise<string> {
  if (!UUID.test(agentSessionId)) throw new Error(`agent session id is not a UUID: ${agentSessionId}`);
  const remote =
    // A push URL that goes nowhere: no push, and so no PR, from this turn.
    `cd ${WORKSPACE} && git remote set-url --push origin no-push && ` +
    // The rest of stdin, after the token's line, is claude's prompt.
    `IFS= read -r CLAUDE_CODE_OAUTH_TOKEN && export CLAUDE_CODE_OAUTH_TOKEN && IS_SANDBOX=1 exec claude -p --output-format stream-json --verbose ` +
    `--permission-mode bypassPermissions --append-system-prompt ${shellQuote(CODESPACE_PROMPT)} ` +
    `${resume ? "--resume" : "--session-id"} ${agentSessionId}`;
  const child = spawn("gh", ["cs", "ssh", "-c", codespace, "--", remote], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(`${oauthToken}\n${prompt}`);

  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));

  return (async () => {
    let result: string | undefined;
    for await (const line of createInterface({ input: child.stdout })) {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // ssh banners and the like
      }
      result = (await narrate(message, onActivity)) ?? result;
    }
    const code = await exited;
    if (result !== undefined) return result;
    throw new Error(`claude in codespace ${codespace} ended without a result (exit ${code}): ${stderr.slice(-500)}`);
  })();
}
