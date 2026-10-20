import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * The git ref a turn's container-use environments start from. Nothing moves
 * the workspace checkout (the host runs its scripts from it), so its HEAD,
 * container-use's default from_git_ref, goes stale: CIT-445's agent built on
 * a two-day-old branch and couldn't find the code its issue was about, and
 * CIT-446's environment carried that branch's leftovers into its diff.
 *
 * Fetches origin first, then picks origin/<the issue's branch> when it
 * exists (a review finding's branch holds the reviewed PR; a shipped issue's
 * branch holds its PR) and origin/main otherwise. A failed fetch is logged,
 * not fatal: the refs from the last fetch are still better than HEAD.
 */
export async function baseRef(dir: string, branch: string | undefined): Promise<string> {
  try {
    await exec("git", ["-C", dir, "fetch", "-q", "--prune", "origin"]);
  } catch (err) {
    console.error(`git fetch in ${dir} failed:`, err);
  }
  if (branch) {
    try {
      await exec("git", ["-C", dir, "rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`]);
      return `origin/${branch}`;
    } catch {
      // Not on origin (yet): start from main.
    }
  }
  return "origin/main";
}
