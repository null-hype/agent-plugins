import type { LinearClient } from "@linear/sdk";

// container-use tools that change an environment's files. A turn that used
// one has work to ship; a turn that only looked around or asked a question
// doesn't.
const EDIT_TOOLS = new Set([
  "mcp__container-use__environment_file_write",
  "mcp__container-use__environment_file_edit",
  "mcp__container-use__environment_file_delete",
]);

/** The environment a tool call edited, if it was an edit. */
export function editedEnvironment(name: string, input: unknown): string | undefined {
  if (!EDIT_TOOLS.has(name)) return undefined;
  const id = (input as { environment_id?: unknown } | null)?.environment_id;
  return typeof id === "string" && id ? id : undefined;
}

export interface ShipTarget {
  branch: string;
  base: string;
  /** The PR that already exists for branch, when there is one to review again. */
  pr?: number;
}

export type PullRequestLookup = (repo: string, pr: number) => Promise<{ head: string; base: string }>;

/**
 * Where an issue's environment ships. A Codex finding names the PR it
 * reviewed ("PR: <url>" in its description), so its fix goes onto that PR's
 * branch and the PR is reviewed again. Anything else ships to the issue's own
 * branch, into main.
 */
export async function shipTarget(
  description: string | undefined,
  branchName: string,
  lookup: PullRequestLookup = pullRequest,
): Promise<ShipTarget> {
  const m = description?.match(/^PR: .*?github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/m);
  if (!m) return { branch: branchName, base: "main" };
  const pr = Number(m[2]);
  const { head, base } = await lookup(m[1], pr);
  return { branch: head, base, pr };
}

// The repo is public, so this needs no token; the agent server holds none.
async function pullRequest(repo: string, pr: number): Promise<{ head: string; base: string }> {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`looking up ${repo}#${pr}: HTTP ${res.status}`);
  const body = (await res.json()) as { head: { ref: string }; base: { ref: string } };
  return { head: body.head.ref, base: body.base.ref };
}

/**
 * The comment that asks Linear's own agent, which holds the toolbox, to ship
 * the environment and have Codex review the PR. Pushing stays outside this
 * agent's sandbox (see claude.ts); this only asks.
 */
export function shipRequest(identifier: string, title: string, env: string, target: ShipTarget): string {
  const review = target.pr ? `PR ${target.pr}` : "the PR it opens";
  return [
    "@linear please ship and review the Claude agent's work on this issue:",
    "",
    `1. \`agent_ship\` with env \`${env}\`, branch \`${target.branch}\`, base \`${target.base}\`, title \`${title} (${identifier})\`.`,
    `2. \`codex_review\` on ${review}, then poll \`codex_review_status\` until \`job_exit\` is set. Report here how many findings and the triage issue for each. Do not delegate any triage issue it files; those wait for a human.`,
  ].join("\n");
}

/**
 * Hands a finished turn's environment on: moves the issue to In Review and
 * posts the ship request. Returns a line for the turn's response, so a
 * failure shows up in the thread instead of only in this server's log.
 */
export async function handOff(
  linear: LinearClient,
  issueId: string,
  env: string,
  lookup: PullRequestLookup = pullRequest,
): Promise<string> {
  try {
    const issue = await linear.issue(issueId);
    const target = await shipTarget(issue.description ?? undefined, issue.branchName, lookup);
    const states = await (await issue.team)?.states({ filter: { name: { eq: "In Review" } } });
    const inReview = states?.nodes[0];
    if (inReview) await linear.updateIssue(issueId, { stateId: inReview.id });
    await linear.createComment({ issueId, body: shipRequest(issue.identifier, issue.title, env, target) });
    // No "@" here: this line goes into the response, and must not mention Linear's agent a second time.
    const moved = inReview ? "Moved this issue to In Review and asked" : "Asked";
    return `${moved} Linear's agent to ship \`${env}\` to \`${target.branch}\` and review it.`;
  } catch (err) {
    return `Couldn't hand \`${env}\` on for shipping: ${err instanceof Error ? err.message : String(err)}`;
  }
}
