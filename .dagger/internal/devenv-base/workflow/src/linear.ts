// Reads the open issues the DAG is built from. Read-only by construction:
// the only request it sends is a GraphQL query.
import type { Issue, Stage } from "./dag.ts";

const OPEN: Stage[] = ["triage", "backlog", "unstarted", "started"];

const QUERY = `query Open($team: String!, $after: String) {
  issues(first: 100, after: $after, filter: {
    team: { key: { eq: $team } },
    state: { type: { in: ["triage", "backlog", "unstarted", "started"] } }
  }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier
      title
      state { type }
      parent { identifier state { type } }
      inverseRelations { nodes { type issue { identifier state { type } } } }
      releases { nodes { name completedAt canceledAt } }
    }
  }
}`;

interface Node {
  identifier: string;
  title: string;
  state: { type: string };
  parent: { identifier: string; state: { type: string } } | null;
  inverseRelations: { nodes: { type: string; issue: { identifier: string; state: { type: string } } }[] };
  releases: { nodes: { name: string; completedAt: string | null; canceledAt: string | null }[] };
}

const isOpen = (type: string) => (OPEN as string[]).includes(type);

export function toIssue(n: Node): Issue {
  return {
    id: n.identifier,
    title: n.title,
    stage: n.state.type as Stage,
    // An inverse "blocks" relation is another issue blocking this one.
    blockedBy: n.inverseRelations.nodes
      .filter((r) => r.type === "blocks" && isOpen(r.issue.state.type))
      .map((r) => r.issue.identifier),
    parent: n.parent && isOpen(n.parent.state.type) ? n.parent.identifier : undefined,
    releases: n.releases.nodes.filter((r) => !r.completedAt && !r.canceledAt).map((r) => r.name),
  };
}

export async function openIssues(apiKey: string, team: string, fetcher = fetch): Promise<Issue[]> {
  const issues: Issue[] = [];
  let after: string | null = null;
  do {
    const res = await fetcher("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query: QUERY, variables: { team, after } }),
    });
    const body = (await res.json()) as {
      data?: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] } };
      errors?: unknown;
    };
    // A failed read is a failed plan, never an empty one: an empty graph
    // would prune everything.
    if (!res.ok || body.errors || !body.data) {
      throw new Error(`Linear query failed (${res.status}): ${JSON.stringify(body.errors ?? body)}`);
    }
    issues.push(...body.data.issues.nodes.map(toIssue));
    after = body.data.issues.pageInfo.hasNextPage ? body.data.issues.pageInfo.endCursor : null;
  } while (after);
  return issues;
}
