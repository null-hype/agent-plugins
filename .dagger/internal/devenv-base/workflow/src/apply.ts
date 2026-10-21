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
import { validate, type Changeset } from "./changeset.ts";

export interface LinearIssue {
  identifier: string;
  updatedAt: string;
  stage: string; // the state type: triage, backlog, unstarted, started, completed, canceled
  parent?: string;
  labels: string[];
  blockedBy: string[];
  // The agent the issue is delegated to, by its Linear name.
  delegate?: string;
}

// The reads and writes apply needs. linear.ts implements it over GraphQL;
// the tests implement it in memory.
export interface LinearClient {
  issue(identifier: string): Promise<LinearIssue | null>;
  // The open or closed issue whose description carries the marker: how a
  // cluster created by an earlier apply is found again.
  findByMarker(marker: string): Promise<LinearIssue | null>;
  createIssue(input: { title: string; description: string; parent: string }): Promise<LinearIssue>;
  // Sets the parent and moves the issue out of Triage, to the team's first
  // unstarted state, if it is still there.
  setParent(issue: string, parent: string): Promise<void>;
  addBlocks(blocker: string, blocked: string): Promise<void>;
  cancel(issue: string): Promise<void>;
  markDuplicate(issue: string, of: string): Promise<void>;
  addLabel(issue: string, label: string): Promise<void>;
  comment(issue: string, body: string): Promise<void>;
  delegate(issue: string, agent: string): Promise<void>;
}

export interface Op {
  op: "create" | "parent" | "blocks" | "decline" | "duplicate" | "escalate" | "delegate";
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
export const marker = (key: string) => `<!-- supervisor-changeset:${key} -->`;

const CLOSED = ["completed", "canceled"];

export async function apply(cs: Changeset, linear: LinearClient, { dryRun }: { dryRun: boolean }): Promise<ApplyResult> {
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

  // 1. Every cluster's parent issue exists, under what it serves.
  for (const c of cs.clusters) {
    if (c.key.startsWith("new:")) {
      const found = await linear.findByMarker(marker(c.key));
      if (found) {
        result.clusters[c.key] = found.identifier;
        continue;
      }
      if (!(await get(c.serves))) {
        result.skipped.push({ op: "create", target: c.key, detail: c.title, why: `${c.serves} does not exist` });
        continue;
      }
      const op: Op = { op: "create", target: c.key, detail: `"${c.title}" under ${c.serves} (${c.hat}, ${c.model}, ${c.effort})` };
      if (dryRun) {
        result.clusters[c.key] = c.key;
      } else {
        const created = await linear.createIssue({
          title: c.title,
          description: `${c.description}\n\n${marker(c.key)}`,
          parent: c.serves,
        });
        cache.set(created.identifier, created);
        result.clusters[c.key] = created.identifier;
      }
      result.applied.push(op);
    } else {
      result.clusters[c.key] = c.key;
      await run(
        { op: "parent", target: c.key, detail: `under ${c.serves} (${c.hat}, ${c.model}, ${c.effort})` },
        (i) => i.parent === c.serves,
        () => linear.setParent(c.key, c.serves),
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
  for (const d of cs.decline) {
    await run(
      { op: "decline", target: d.issue, detail: d.reason },
      (i) => CLOSED.includes(i.stage),
      async () => {
        await linear.comment(d.issue, `Declined by planning: ${d.reason}`);
        await linear.cancel(d.issue);
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
        await linear.comment(e.issue, `Escalated by planning: ${e.question}`);
        await linear.addLabel(e.issue, ESCALATE_LABEL);
      },
    );
  }

  // 5. Hand ready work to an agent, last, so it lands on the structure above.
  // Delegating fires the AgentSessionEvent the agent acts on.
  for (const d of cs.delegate) {
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
    // Reads are cached for the run, so an issue parented above is still
    // judged against what planning saw, not against apply's own write.
    await run(op, (i) => i.delegate === d.agent, () => linear.delegate(target, d.agent), target);
  }
  return result;
}
