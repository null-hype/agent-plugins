import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * LINEAR_AGENT_SANDBOX=worktree: each agent session works in its own git
 * worktree of LINEAR_AGENT_REPO_DIR, on branch agent/<session>, cut from
 * LINEAR_AGENT_BASE_REF (default origin/main). A follow-up prompt on the same
 * session reuses the worktree, so the branch carries the whole thread's work.
 * When a turn leaves commits on the branch, finish() pushes it -- which runs
 * the repo's pre-push hooks, including the Codex review -- and opens a PR.
 */
export interface Worktree {
  dir: string;
  branch: string;
  base: string;
}

const REPO_DIR = process.env.LINEAR_AGENT_REPO_DIR ?? process.env.DEVENV_BASE_WORKSPACE_DIR ?? "";
const BASE_REF = process.env.LINEAR_AGENT_BASE_REF ?? "origin/main";
const WORKTREES_DIR = process.env.LINEAR_AGENT_WORKTREES_DIR ?? path.join(REPO_DIR, "..", "linear-agent-worktrees");

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function prepare(agentSessionId: string): Promise<Worktree> {
  if (!REPO_DIR) throw new Error("LINEAR_AGENT_REPO_DIR is not set");
  const branch = `agent/${agentSessionId.slice(0, 8)}`;
  const dir = path.join(WORKTREES_DIR, agentSessionId);
  if (!existsSync(dir)) {
    await git(REPO_DIR, "fetch", "--quiet", "origin");
    await git(REPO_DIR, "worktree", "add", "--quiet", "-B", branch, dir, BASE_REF);
  }
  return { dir, branch, base: BASE_REF };
}

/**
 * Pushes the branch and opens (or finds) its PR when the turn committed
 * anything. Returns a line for the Linear response, or undefined when there
 * was nothing to push.
 */
export async function finish(wt: Worktree, title: string): Promise<string | undefined> {
  const ahead = Number(await git(wt.dir, "rev-list", "--count", `${wt.base}..HEAD`));
  if (ahead === 0) return undefined;
  await git(wt.dir, "push", "--quiet", "-u", "origin", `HEAD:refs/heads/${wt.branch}`);
  const { stdout: existing } = await run(
    "gh", ["pr", "list", "--head", wt.branch, "--state", "open", "--json", "url", "--jq", ".[0].url // empty"],
    { cwd: wt.dir },
  );
  if (existing.trim()) return `Pushed ${ahead} commit(s) to ${existing.trim()}`;
  const body = await git(wt.dir, "log", "--reverse", "--format=%B", `${wt.base}..HEAD`);
  const { stdout: url } = await run(
    "gh",
    ["pr", "create", "--head", wt.branch, "--base", wt.base.replace(/^origin\//, ""), "--title", title, "--body", body],
    { cwd: wt.dir },
  );
  return `Opened ${url.trim()} (${ahead} commit(s)); Codex reviews it on push.`;
}
