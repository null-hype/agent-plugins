// The `apply` task's logic (CIT-472): make Linear match the changeset that
// planning committed. Merging the calibration PR is what applies it: Render
// deploys main, and the deployed workflow converges Linear to the committed
// changeset. So apply is idempotent by construction -- every op first asks
// whether Linear already says what the changeset says, and does nothing if
// it does. Whatever triggers it after a deploy, the second run is a no-op.
//
// Drift: planning recorded each issue's updatedAt. An op whose target has
// changed since, and is not already satisfied, is skipped rather than
// applied over someone's newer change; it shows in the result, and the next
// calibration plans it again.
//
// Dry run is calibration's test: it reads real Linear, decides every op the
// same way, and writes nothing.
import { createHash } from "node:crypto";
import { RELEASE_PREFIX, validate, type Changeset, type Cluster } from "./changeset.ts";

export interface LinearIssue {
  identifier: string;
  updatedAt: string;
  stage: string; // the state type: triage, backlog, unstarted, started, completed, canceled
  parent?: string;
  labels: string[];
  blockedBy: string[];
  // The agent the issue is delegated to, by its Linear name.
  delegate?: string;
  // The open Releases it is in, by name.
  releases: string[];
  // Its git branch, as Linear names it: where a ship pushes.
  branch: string;
  // The container-use environments apply has shipped for it, read back from
  // the note each ship leaves since the last ask handed it back.
  shipped: string[];
  // The pull requests apply has had reviewed for it, from each review's note.
  reviewed: number[];
  // The asks apply has handed it with, by askId, from each ask's note.
  asked?: string[];
  // The thread of each agent's latest session on it, by the agent's name as
  // Linear words the thread ("an agent session with claude"): a reply there
  // is how an agent that already has the issue is asked again.
  sessions?: Record<string, string>;
}

// The toolbox, for the ops that reach the host. apply never calls it in
// a dry run.
export interface Toolbox {
  // Brings the host up and returns once the Linear agent can take work.
  wake(): Promise<void>;
  ship(env: string, branch: string): Promise<void>;
  review(pr: number): Promise<void>;
}

// The reads and writes apply needs. linear.ts implements it over GraphQL;
// the tests implement it in memory.
export interface LinearClient {
  issue(identifier: string): Promise<LinearIssue | null>;
  // The open or closed issue whose description carries the marker: how a
  // cluster created by an earlier apply is found again.
  findByMarker(marker: string): Promise<LinearIssue | null>;
  // With no parent, the issue is created at the top, to be added to a
  // Release.
  createIssue(input: { title: string; description: string; parent?: string }): Promise<LinearIssue>;
  // Sets the parent and moves the issue out of Triage, to the team's first
  // unstarted state, if it is still there.
  setParent(issue: string, parent: string): Promise<void>;
  addBlocks(blocker: string, blocked: string): Promise<void>;
  cancel(issue: string): Promise<void>;
  complete(issue: string): Promise<void>;
  markDuplicate(issue: string, of: string): Promise<void>;
  addLabel(issue: string, label: string): Promise<void>;
  // Labels and the users or agents work is delegated to, by name. A dry run
  // asks for every name a write would need, so it fails where apply would.
  hasLabel(name: string): Promise<boolean>;
  createLabel(name: string): Promise<void>;
  hasUser(name: string): Promise<boolean>;
  // With a thread, the comment is a reply in it.
  comment(issue: string, body: string, thread?: string): Promise<void>;
  delegate(issue: string, agent: string): Promise<void>;
  // Clears the issue's delegate, so delegating it again starts a new agent
  // session.
  undelegate(issue: string): Promise<void>;
  // Releases and their pipelines, by name. Only open Releases are found.
  hasPipeline(name: string): Promise<boolean>;
  createPipeline(name: string): Promise<void>;
  hasRelease(name: string): Promise<boolean>;
  createRelease(input: { name: string; description: string; pipeline: string }): Promise<void>;
  addToRelease(issue: string, release: string): Promise<void>;
}

export interface Op {
  op: "pipeline" | "release" | "label" | "create" | "attach" | "parent" | "blocks" | "decline" | "done" | "duplicate" | "escalate" | "delegate" | "ship" | "review";
  target: string;
  detail: string;
}

export interface ApplyResult {
  dryRun: boolean;
  // What was done (or, in a dry run, would be done), in order.
  applied: Op[];
  // Ops whose target changed since planning or no longer exists.
  skipped: (Op & { why: string })[];
  // The issue each cluster key resolved to; a cluster that does not exist
  // yet resolves to its own key in a dry run.
  clusters: Record<string, string>;
}

export const ESCALATE_LABEL = "needs-maintainer";
// No colons: Linear turns ":new:" in a description into the 🆕 emoji, so a
// marker written as "changeset:new:slug" is never found again.
export const marker = (key: string) => `<!-- supervisor-changeset ${key.replaceAll(":", "/")} -->`;
// The note a ship leaves on its issue, which is how a rerun knows it shipped.
export const shipMarker = (env: string) => `<!-- supervisor-ship ${env} -->`;
// The note a review leaves on its issue, the same way.
export const reviewMarker = (pr: number) => `<!-- supervisor-review ${pr} -->`;
// The note an ask leaves, by a short hash of the ask: one ask is posted once.
export const askId = (ask: string) => createHash("sha256").update(ask).digest("hex").slice(0, 12);
export const askMarker = (ask: string) => `<!-- supervisor-ask ${askId(ask)} -->`;

const CLOSED = ["completed", "canceled"];

export async function apply(
  cs: Changeset,
  linear: LinearClient,
  { dryRun, toolbox }: { dryRun: boolean; toolbox?: Toolbox },
): Promise<ApplyResult> {
  const problems = validate(cs);
  if (problems.length) throw new Error(`the changeset is invalid:\n- ${problems.join("\n- ")}`);

  const result: ApplyResult = { dryRun, applied: [], skipped: [], clusters: {} };
  const cache = new Map<string, LinearIssue | null>();
  const get = async (id: string) => {
    if (!cache.has(id)) cache.set(id, await linear.issue(id));
    return cache.get(id)!;
  };

  // Do an op unless Linear already agrees, or its target drifted or is gone.
  const run = async (op: Op, satisfied: (i: LinearIssue) => boolean, write: () => Promise<void>, target = op.target) => {
    const issue = await get(target);
    if (!issue) {
      result.skipped.push({ ...op, why: `${target} does not exist` });
      return;
    }
    if (satisfied(issue)) return;
    if (target in cs.seen && issue.updatedAt !== cs.seen[target]) {
      result.skipped.push({ ...op, why: `${target} changed since planning` });
      return;
    }
    if (!dryRun) await write();
    result.applied.push(op);
  };

  // 0. The Releases the clusters serve exist, each in its pipeline. They
  // are the changeset's own, so there is no drift to check: a Release of the
  // same name that someone made since is simply used.
  const pipelines = new Set<string>();
  for (const r of cs.releases) {
    if (await linear.hasRelease(r.name)) continue;
    if (!pipelines.has(r.pipeline) && !(await linear.hasPipeline(r.pipeline))) {
      if (!dryRun) await linear.createPipeline(r.pipeline);
      result.applied.push({ op: "pipeline", target: r.pipeline, detail: "a new release pipeline" });
    }
    pipelines.add(r.pipeline);
    if (!dryRun) await linear.createRelease(r);
    result.applied.push({ op: "release", target: r.name, detail: `in ${r.pipeline}: ${r.description}` });
  }

  // The label escalations carry exists. Like a Release, it is apply's own.
  if (cs.escalate.length && !(await linear.hasLabel(ESCALATE_LABEL))) {
    if (!dryRun) await linear.createLabel(ESCALATE_LABEL);
    result.applied.push({ op: "label", target: ESCALATE_LABEL, detail: "a new label for escalations" });
  }

  // 1. Every cluster's parent issue exists, under the issue it serves or in
  // the Release it serves.
  const release = (c: Cluster) => (c.serves.startsWith(RELEASE_PREFIX) ? c.serves.slice(RELEASE_PREFIX.length) : undefined);
  const into = (c: Cluster) => `${release(c) ? `in release ${release(c)}` : `under ${c.serves}`} (${c.hat}, ${c.model}, ${c.effort})`;
  for (const c of cs.clusters) {
    const name = release(c);
    if (c.key.startsWith("new:")) {
      const found = await linear.findByMarker(marker(c.key));
      if (found) {
        result.clusters[c.key] = found.identifier;
        cache.set(found.identifier, found);
        // An earlier apply created it; it may have stopped short of adding
        // it to its Release.
        if (name && !found.releases.includes(name)) {
          if (!dryRun) await linear.addToRelease(found.identifier, name);
          result.applied.push({ op: "attach", target: found.identifier, detail: `to release ${name}` });
        }
        continue;
      }
      if (!name && !(await get(c.serves))) {
        result.skipped.push({ op: "create", target: c.key, detail: c.title, why: `${c.serves} does not exist` });
        continue;
      }
      const op: Op = { op: "create", target: c.key, detail: `"${c.title}" ${into(c)}` };
      if (dryRun) {
        result.clusters[c.key] = c.key;
      } else {
        const created = await linear.createIssue({
          title: c.title,
          description: `${c.description}\n\n${marker(c.key)}`,
          ...(name ? {} : { parent: c.serves }),
        });
        if (name) await linear.addToRelease(created.identifier, name);
        cache.set(created.identifier, created);
        result.clusters[c.key] = created.identifier;
      }
      result.applied.push(op);
    } else {
      result.clusters[c.key] = c.key;
      await run(
        name
          ? { op: "attach", target: c.key, detail: into(c) }
          : { op: "parent", target: c.key, detail: into(c) },
        (i) => (name ? i.releases.includes(name) : i.parent === c.serves),
        () => (name ? linear.addToRelease(c.key, name) : linear.setParent(c.key, c.serves)),
      );
    }
  }
  const resolve = (ref: string) => result.clusters[ref] ?? ref;
  const exists = (key: string) => key in result.clusters;

  // 2. Members become sub-issues of their cluster, which takes them out of
  // Triage.
  for (const c of cs.clusters) {
    if (!exists(c.key)) continue;
    const parent = resolve(c.key);
    for (const id of c.issues) {
      await run(
        { op: "parent", target: id, detail: `into ${parent}` },
        (i) => i.parent === parent && i.stage !== "triage",
        () => linear.setParent(id, parent),
      );
    }
  }

  // 3. The blocks edges between clusters.
  for (const c of cs.clusters) {
    if (!exists(c.key)) continue;
    const blocked = resolve(c.key);
    for (const ref of c.blockedBy) {
      const blocker = resolve(ref);
      const op: Op = { op: "blocks", target: blocked, detail: `blocked by ${blocker}` };
      if (cs.clusters.some((x) => x.key === ref) && !exists(ref)) {
        result.skipped.push({ ...op, why: `cluster ${ref} was not created` });
        continue;
      }
      // In a dry run a cluster still to be created has no issue to look at,
      // and an edge to it is always new.
      if (blocked.startsWith("new:") || blocker.startsWith("new:")) {
        result.applied.push(op);
        continue;
      }
      const missing = (await get(blocker)) ? (await get(blocked)) ? null : blocked : blocker;
      if (missing) {
        result.skipped.push({ ...op, why: `${missing} does not exist` });
        continue;
      }
      // The edge belongs to the cluster, which apply owns: no drift check.
      if ((await get(blocked))!.blockedBy.includes(blocker)) continue;
      if (!dryRun) await linear.addBlocks(blocker, blocked);
      result.applied.push(op);
    }
  }

  // 4. What was not clustered.
  for (const d of cs.done ?? []) {
    await run(
      { op: "done", target: d.issue, detail: d.evidence },
      (i) => i.stage === "completed",
      async () => {
        await linear.complete(d.issue);
        await linear.comment(d.issue, `Done, by planning: ${d.evidence}`);
      },
    );
  }
  for (const d of cs.decline) {
    await run(
      { op: "decline", target: d.issue, detail: d.reason },
      (i) => CLOSED.includes(i.stage),
      // The state first: it is what a rerun checks, so a comment is never
      // written twice.
      async () => {
        await linear.cancel(d.issue);
        await linear.comment(d.issue, `Declined by planning: ${d.reason}`);
      },
    );
  }
  for (const d of cs.duplicate) {
    await run(
      { op: "duplicate", target: d.issue, detail: `of ${d.of}` },
      (i) => CLOSED.includes(i.stage),
      () => linear.markDuplicate(d.issue, d.of),
    );
  }
  for (const e of cs.escalate) {
    await run(
      { op: "escalate", target: e.issue, detail: e.question },
      (i) => i.labels.includes(ESCALATE_LABEL),
      async () => {
        await linear.addLabel(e.issue, ESCALATE_LABEL);
        await linear.comment(e.issue, `Escalated by planning: ${e.question}`);
      },
    );
  }

  // The host is woken once, before the first write that needs it: the agent
  // acts on a delegation only while its webhook answers, and a ship runs on
  // the host.
  let awake = false;
  const host = async () => {
    if (awake) return;
    if (!toolbox) throw new Error("this apply has no toolbox, and a delegation, a ship or a review needs the host");
    await toolbox.wake();
    awake = true;
  };

  // 5. Hand ready work to an agent, last, so it lands on the structure above.
  // Delegating fires the AgentSessionEvent the agent acts on.
  const agents = new Map<string, boolean>();
  for (const d of cs.delegate) {
    if (!agents.has(d.agent)) agents.set(d.agent, await linear.hasUser(d.agent));
    if (!agents.get(d.agent)) {
      result.skipped.push({ op: "delegate", target: d.issue, detail: `to ${d.agent}`, why: `no Linear user or agent named ${d.agent}` });
      continue;
    }
    if (d.issue.startsWith("new:") && !exists(d.issue)) {
      result.skipped.push({ op: "delegate", target: d.issue, detail: `to ${d.agent}`, why: `cluster ${d.issue} was not created` });
      continue;
    }
    const target = resolve(d.issue);
    const op: Op = { op: "delegate", target, detail: `to ${d.agent}` };
    if (target.startsWith("new:")) {
      result.applied.push(op);
      continue;
    }
    // An ask hands the issue back, even to the agent that has it. An agent
    // acts only on a session event: a reply in its session's thread prompts
    // it there (re-delegating an issue it has starts nothing), and without a
    // session the ask is posted and the issue delegated. A ship that
    // conflicts with main goes back this way.
    if (d.ask) {
      const ask = d.ask;
      await run(
        { ...op, detail: `to ${d.agent}, asking: ${ask}` },
        (i) => (i.asked ?? []).includes(askId(ask)),
        async () => {
          await host();
          const now = await linear.issue(target);
          const thread = now?.sessions?.[d.agent.toLowerCase()];
          await linear.comment(target, `${ask}\n\n${askMarker(ask)}`, thread);
          if (thread) return;
          if (now?.delegate === d.agent) await linear.undelegate(target);
          await linear.delegate(target, d.agent);
        },
        target,
      );
      continue;
    }
    // Reads are cached for the run, so an issue parented above is still
    // judged against what planning saw, not against apply's own write.
    await run(
      op,
      (i) => i.delegate === d.agent,
      async () => {
        await host();
        await linear.delegate(target, d.agent);
      },
      target,
    );
  }

  // 6. Ship finished environments, each once. The ship's own note is the
  // record, so it is not a drift check: an issue the agent touched while it
  // worked is still shipped.
  for (const s of cs.ship ?? []) {
    const issue = await get(s.issue);
    const op: Op = { op: "ship", target: s.issue, detail: `${s.env} to ${issue?.branch ?? "its branch"}` };
    if (!issue) {
      result.skipped.push({ ...op, why: `${s.issue} does not exist` });
      continue;
    }
    if (issue.shipped.includes(s.env)) continue;
    if (!dryRun) {
      await host();
      await toolbox!.ship(s.env, issue.branch);
      await linear.comment(s.issue, `Shipping \`${s.env}\` to \`${issue.branch}\` (agent_ship). ${shipMarker(s.env)}`);
    }
    result.applied.push(op);
  }

  // 7. Review pull requests with Codex, each once, noted the same way. Its
  // findings land in Triage for the next run.
  for (const r of cs.review ?? []) {
    const issue = await get(r.issue);
    const op: Op = { op: "review", target: r.issue, detail: `PR #${r.pr} (codex_review)` };
    if (!issue) {
      result.skipped.push({ ...op, why: `${r.issue} does not exist` });
      continue;
    }
    if (issue.reviewed.includes(r.pr)) continue;
    if (!dryRun) {
      await host();
      await toolbox!.review(r.pr);
      await linear.comment(r.issue, `Reviewing PR #${r.pr} with Codex (codex_review). ${reviewMarker(r.pr)}`);
    }
    result.applied.push(op);
  }
  return result;
}
