import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * LINEAR_AGENT_SANDBOX=codespace: this server only makes the codespace. Each
 * agent session's turn runs in a codespace of LINEAR_AGENT_CODESPACE_REPO
 * made from a rendered agent template (default .devcontainer/agent-task-linear/,
 * see scripts/render-agent-template.py), with the session id as its display
 * name. The template's agent-task feature (linear mode) does the rest from
 * its postStartCommand: it reads the prompt from the session, runs Claude and
 * the Codex review, opens a PR, posts the outcome here and deletes the
 * codespace. --idle-timeout (long: the task itself is not "activity") and
 * --retention-period clean up after a failed run.
 */
const REPO = process.env.LINEAR_AGENT_CODESPACE_REPO ?? "null-hype/agent-plugins";
const BRANCH = process.env.LINEAR_AGENT_CODESPACE_BRANCH ?? "main";
const MACHINE = process.env.LINEAR_AGENT_CODESPACE_MACHINE ?? "basicLinux32gb";
const TEMPLATE = process.env.LINEAR_AGENT_CODESPACE_TEMPLATE ?? ".devcontainer/agent-task-linear/devcontainer.json";

/**
 * Creates the session's codespace and returns its name -- or, when one for
 * this session is still there (the previous turn is running), returns that
 * one's name and running=true without making another.
 */
export async function dispatch(agentSessionId: string): Promise<{ name: string; running: boolean }> {
  const { stdout } = await run("gh", ["cs", "list", "-R", REPO, "--json", "name,displayName"]);
  const existing = (JSON.parse(stdout || "[]") as { name: string; displayName: string }[]).find(
    (cs) => cs.displayName === agentSessionId,
  );
  if (existing) return { name: existing.name, running: true };
  const { stdout: created } = await run("gh", [
    "cs", "create", "-R", REPO, "-b", BRANCH, "-m", MACHINE,
    "--devcontainer-path", TEMPLATE, "--display-name", agentSessionId,
    "--idle-timeout", "240m", "--retention-period", "1h", "--default-permissions",
  ]);
  return { name: created.trim().split("\n").pop()!, running: false };
}
