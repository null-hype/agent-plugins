// The planning hat's DAG (CIT-472). Linear holds the graph: the nodes are
// open issues, the edges are its blocks relations and sub-issue links, and
// the sinks are what gets published -- open Releases, or a delivery issue
// like CIT-439 until a Release exists. This file only projects it: it never
// writes to Linear, so a plan can be computed against the real workspace on
// the dev server without changing anything.

export type Stage = "triage" | "backlog" | "unstarted" | "started";

export interface Issue {
  id: string; // the identifier, e.g. CIT-465
  title: string;
  stage: Stage;
  // Issues that must finish first. Only open ones count; a done blocker is
  // simply absent.
  blockedBy: string[];
  // The parent, whose delivery this issue is part of.
  parent?: string;
  // The open Releases this issue ships in, by name.
  releases: string[];
}

export interface Plan {
  // The sinks the plan was built back from.
  sinks: string[];
  // Kept issues in dependency order: every issue comes after everything that
  // blocks it, so a run can take them front to back.
  order: PlannedIssue[];
  // Open issues that reach no sink: nothing published depends on them, so
  // planning declines them or leaves them dormant.
  pruned: string[];
  // Issues on a blocks cycle, or behind one. No order can satisfy them, so
  // planning escalates them rather than guessing which edge is wrong.
  cycles: string[];
}

export interface PlannedIssue {
  id: string;
  title: string;
  // triage: planning must accept it before anything runs.
  // ready: accepted, and nothing open blocks it.
  // waiting: accepted, but blocked by an open issue in the plan.
  status: "triage" | "ready" | "waiting";
  blockedBy: string[];
  // The sinks it serves.
  serves: string[];
}

const releaseSink = (name: string) => `release:${name}`;

export function plan(issues: Issue[], deliveries: string[] = []): Plan {
  const byId = new Map(issues.map((i) => [i.id, i]));

  // feeds[x] is everything x is a prerequisite of: the issues it blocks,
  // its parent, and its Releases. A sink is reached by following feeds.
  const feeds = new Map<string, Set<string>>();
  const edge = (from: string, to: string) => {
    if (!feeds.has(from)) feeds.set(from, new Set());
    feeds.get(from)!.add(to);
  };
  const sinks = new Set<string>(deliveries.filter((d) => byId.has(d)));
  for (const i of issues) {
    for (const b of i.blockedBy) if (byId.has(b)) edge(b, i.id);
    if (i.parent && byId.has(i.parent)) edge(i.id, i.parent);
    for (const r of i.releases) {
      sinks.add(releaseSink(r));
      edge(i.id, releaseSink(r));
    }
  }

  // Walk backwards from each sink to find what serves it.
  const fedBy = new Map<string, Set<string>>();
  for (const [from, tos] of feeds) {
    for (const to of tos) {
      if (!fedBy.has(to)) fedBy.set(to, new Set());
      fedBy.get(to)!.add(from);
    }
  }
  const serves = new Map<string, Set<string>>();
  for (const sink of sinks) {
    const seen = new Set<string>([sink]);
    const queue = [sink];
    while (queue.length) {
      const n = queue.shift()!;
      if (byId.has(n)) {
        if (!serves.has(n)) serves.set(n, new Set());
        serves.get(n)!.add(sink);
      }
      for (const prev of fedBy.get(n) ?? []) {
        if (!seen.has(prev)) {
          seen.add(prev);
          queue.push(prev);
        }
      }
    }
  }

  const kept = issues.filter((i) => serves.has(i.id));
  const pruned = issues.filter((i) => !serves.has(i.id)).map((i) => i.id);

  // Kahn's algorithm over the blocks edges among kept issues, ties broken by
  // input order so the same Linear state always gives the same plan.
  const keptIds = new Set(kept.map((i) => i.id));
  const blockers = new Map(
    kept.map((i) => [i.id, i.blockedBy.filter((b) => keptIds.has(b))]),
  );
  const blocks = new Map<string, string[]>();
  for (const [id, bs] of blockers) {
    for (const b of bs) blocks.set(b, [...(blocks.get(b) ?? []), id]);
  }
  const remaining = new Map(kept.map((i) => [i.id, blockers.get(i.id)!.length]));
  const order: PlannedIssue[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const i of kept) {
      if (remaining.get(i.id) !== 0) continue;
      remaining.delete(i.id);
      progressed = true;
      const open = blockers.get(i.id)!;
      order.push({
        id: i.id,
        title: i.title,
        status: i.stage === "triage" ? "triage" : open.length ? "waiting" : "ready",
        blockedBy: open,
        serves: [...serves.get(i.id)!].sort(),
      });
      for (const j of blocks.get(i.id) ?? []) {
        remaining.set(j, remaining.get(j)! - 1);
      }
    }
  }
  const cycles = [...remaining.keys()];

  return { sinks: [...sinks].sort(), order, pruned, cycles };
}
