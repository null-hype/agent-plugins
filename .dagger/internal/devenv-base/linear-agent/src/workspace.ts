import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Brings the workspace checkout up to date before a turn. container-use
 * creates environments from its HEAD by default, and nothing used to move
 * it: CIT-445's agent built on a two-day-old branch and couldn't find the
 * code its issue was about, and CIT-446's environment carried that branch's
 * leftovers into its diff.
 *
 * Fetches origin and detaches HEAD at origin/main, which is also where the
 * host's AGENT_SCRIPTS should come from. Every turn moves it to the same
 * place, so concurrent turns don't fight over it. Failures are logged, not
 * fatal: a stale checkout still runs the turn.
 *
 * Returns origin/<the issue's branch> when that branch exists (a review
 * finding's branch holds the reviewed PR; a shipped issue's branch holds its
 * PR): that code isn't on main, so the turn has to be pointed at it.
 */
export async function syncWorkspace(dir: string, branch: string | undefined): Promise<string | undefined> {
  for (const args of [["fetch", "-q", "--prune", "origin"], ["checkout", "-q", "--detach", "origin/main"]]) {
    try {
      await exec("git", ["-C", dir, ...args]);
    } catch (err) {
      console.error(`git ${args[0]} in ${dir} failed:`, err);
    }
  }
  if (!branch) return undefined;
  try {
    await exec("git", ["-C", dir, "rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`]);
    return `origin/${branch}`;
  } catch {
    return undefined;
  }
}
