// Reads the open issues the DAG is built from, and Triage Intelligence's
// hints for planning. Read-only by construction: the only requests they send
// are GraphQL queries.
import type { Hint, Issue, Stage } from "./dag.ts";
import type { LinearClient, LinearIssue } from "./apply.ts";

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
      updatedAt
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
  updatedAt: string;
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
    updatedAt: n.updatedAt,
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

// Triage Intelligence's suggestions for the team's Triage issues. Linear
// marks these fields internal, so they may change or vanish: unlike the DAG,
// a failed read here leaves planning without hints rather than failing it.
const HINTS_QUERY = `query Hints($team: String!, $after: String) {
  issues(first: 50, after: $after, filter: {
    team: { key: { eq: $team } },
    state: { type: { eq: "triage" } }
  }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier
      suggestions(first: 10) {
        nodes {
          type
          state
          suggestedIssue { identifier }
          suggestedLabel { name }
          suggestedProject { name }
          presentedReasons { text }
        }
      }
    }
  }
}`;

interface SuggestionNode {
  type: string;
  state: string;
  suggestedIssue: { identifier: string } | null;
  suggestedLabel: { name: string } | null;
  suggestedProject: { name: string } | null;
  presentedReasons: { text: string }[] | null;
}

// Only active suggestions of the kinds clustering can use; one already
// accepted or dismissed has been decided by someone.
export function toHints(nodes: SuggestionNode[]): Hint[] {
  const hints: Hint[] = [];
  for (const s of nodes) {
    if (s.state !== "active") continue;
    const target =
      s.type === "similarIssue" || s.type === "relatedIssue"
        ? s.suggestedIssue?.identifier
        : s.type === "label"
          ? s.suggestedLabel?.name
          : s.type === "project"
            ? s.suggestedProject?.name
            : undefined;
    if (!target) continue;
    const reason = s.presentedReasons?.map((r) => r.text).join(" ").trim();
    hints.push({ type: s.type as Hint["type"], target, ...(reason ? { reason } : {}) });
  }
  return hints;
}

export async function triageHints(apiKey: string, team: string, fetcher = fetch): Promise<Record<string, Hint[]>> {
  const hints: Record<string, Hint[]> = {};
  let after: string | null = null;
  try {
    do {
      const res = await fetcher("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query: HINTS_QUERY, variables: { team, after } }),
      });
      const body = (await res.json()) as {
        data?: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            nodes: { identifier: string; suggestions: { nodes: SuggestionNode[] } }[];
          };
        };
        errors?: unknown;
      };
      if (!res.ok || body.errors || !body.data) {
        throw new Error(`(${res.status}): ${JSON.stringify(body.errors ?? body)}`);
      }
      for (const n of body.data.issues.nodes) {
        const h = toHints(n.suggestions.nodes);
        if (h.length) hints[n.identifier] = h;
      }
      after = body.data.issues.pageInfo.hasNextPage ? body.data.issues.pageInfo.endCursor : null;
    } while (after);
  } catch (e) {
    console.warn(`Triage Intelligence suggestions unavailable, planning without hints: ${e instanceof Error ? e.message : e}`);
    return {};
  }
  return hints;
}

// apply's reads and writes over GraphQL. Issues are named by identifier
// (CIT-465), which Linear accepts wherever an id is asked for; the inputs
// that want a UUID (parentId, relations) are resolved through `issue`.
const ISSUE_FIELDS = `id identifier updatedAt description
  state { type }
  parent { identifier }
  labels { nodes { name } }
  delegate { name }
  releases { nodes { name completedAt canceledAt } }
  inverseRelations { nodes { type issue { identifier } } }`;

interface IssueNode {
  id: string;
  identifier: string;
  updatedAt: string;
  description: string | null;
  state: { type: string };
  parent: { identifier: string } | null;
  labels: { nodes: { name: string }[] };
  delegate: { name: string } | null;
  releases: { nodes: { name: string; completedAt: string | null; canceledAt: string | null }[] };
  inverseRelations: { nodes: { type: string; issue: { identifier: string } }[] };
}

const toLinearIssue = (n: IssueNode): LinearIssue => ({
  identifier: n.identifier,
  updatedAt: n.updatedAt,
  stage: n.state.type,
  parent: n.parent?.identifier,
  labels: n.labels.nodes.map((l) => l.name),
  blockedBy: n.inverseRelations.nodes.filter((r) => r.type === "blocks").map((r) => r.issue.identifier),
  delegate: n.delegate?.name,
  releases: n.releases.nodes.filter((r) => !r.completedAt && !r.canceledAt).map((r) => r.name),
});

export function linearClient(apiKey: string, team: string, fetcher = fetch): LinearClient {
  const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetcher("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (!res.ok || body.errors || !body.data) {
      throw new Error(`Linear request failed (${res.status}): ${JSON.stringify(body.errors ?? body)}`);
    }
    return body.data;
  };
  const uuid = async (identifier: string) =>
    (await gql<{ issue: { id: string } }>(`query($id: String!) { issue(id: $id) { id } }`, { id: identifier })).issue.id;

  // The team's states, by type, first by position: Todo for "unstarted".
  interface Team {
    id: string;
    states: { nodes: { id: string; type: string; position: number }[] };
  }
  let teamCache: Team | undefined;
  const teamInfo = async () => {
    teamCache ??= (
      await gql<{ teams: { nodes: Team[] } }>(
        `query($team: String!) { teams(filter: { key: { eq: $team } }) { nodes { id states { nodes { id type position } } } } }`,
        { team },
      )
    ).teams.nodes[0];
    if (!teamCache) throw new Error(`no Linear team ${team}`);
    return teamCache;
  };
  const stateOf = async (type: string) => {
    const s = (await teamInfo()).states.nodes.filter((x) => x.type === type).sort((a, b) => a.position - b.position)[0];
    if (!s) throw new Error(`team ${team} has no ${type} state`);
    return s.id;
  };
  const pipeline = async (name: string) =>
    (
      await gql<{ releasePipelines: { nodes: { id: string; type: string }[] } }>(
        `query($name: String!) { releasePipelines(filter: { name: { eq: $name } }) { nodes { id type } } }`,
        { name },
      )
    ).releasePipelines.nodes[0];
  // Only an open Release counts: a finished one with the same name is history.
  const releaseId = async (name: string) =>
    (
      await gql<{ releases: { nodes: { id: string; completedAt: string | null; canceledAt: string | null }[] } }>(
        `query($name: String!) { releases(filter: { name: { eq: $name } }) { nodes { id completedAt canceledAt } } }`,
        { name },
      )
    ).releases.nodes.find((r) => !r.completedAt && !r.canceledAt)?.id;
  const labelId = async (name: string) =>
    (
      await gql<{ issueLabels: { nodes: { id: string }[] } }>(
        `query($name: String!) { issueLabels(filter: { name: { eq: $name } }) { nodes { id } } }`,
        { name },
      )
    ).issueLabels.nodes[0]?.id;
  const userId = async (name: string) =>
    (
      await gql<{ users: { nodes: { id: string }[] } }>(
        `query($name: String!) { users(filter: { name: { eq: $name } }) { nodes { id } } }`,
        { name },
      )
    ).users.nodes[0]?.id;
  const update = (id: string, input: Record<string, unknown>) =>
    gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id, input });
  const relate = async (issue: string, related: string, type: "blocks" | "duplicate") =>
    gql(`mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }`, {
      input: { issueId: await uuid(issue), relatedIssueId: await uuid(related), type },
    });

  return {
    async issue(identifier) {
      try {
        const d = await gql<{ issue: IssueNode | null }>(`query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: identifier });
        return d.issue ? toLinearIssue(d.issue) : null;
      } catch (e) {
        // Linear answers an unknown identifier with an "Entity not found" error.
        if (String(e).includes("not found")) return null;
        throw e;
      }
    },
    async findByMarker(marker) {
      const d = await gql<{ issues: { nodes: IssueNode[] } }>(
        `query($team: String!, $marker: String!) { issues(first: 1, includeArchived: true, filter: { team: { key: { eq: $team } }, description: { contains: $marker } }) { nodes { ${ISSUE_FIELDS} } } }`,
        { team, marker },
      );
      return d.issues.nodes[0] ? toLinearIssue(d.issues.nodes[0]) : null;
    },
    async createIssue({ title, description, parent }) {
      const d = await gql<{ issueCreate: { issue: IssueNode } }>(
        `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE_FIELDS} } } }`,
        {
          input: {
            teamId: (await teamInfo()).id,
            title,
            description,
            ...(parent ? { parentId: await uuid(parent) } : {}),
            stateId: await stateOf("unstarted"),
          },
        },
      );
      return toLinearIssue(d.issueCreate.issue);
    },
    async setParent(issue, parent) {
      const current = await this.issue(issue);
      await update(issue, {
        parentId: await uuid(parent),
        ...(current?.stage === "triage" ? { stateId: await stateOf("unstarted") } : {}),
      });
    },
    async addBlocks(blocker, blocked) {
      await relate(blocker, blocked, "blocks");
    },
    async cancel(issue) {
      await update(issue, { stateId: await stateOf("canceled") });
    },
    async markDuplicate(issue, of) {
      await relate(issue, of, "duplicate");
      await update(issue, { stateId: await stateOf("canceled") });
    },
    async addLabel(issue, label) {
      const id = await labelId(label);
      if (!id) throw new Error(`no Linear label ${label}`);
      await gql(`mutation($id: String!, $labelId: String!) { issueAddLabel(id: $id, labelId: $labelId) { success } }`, {
        id: issue,
        labelId: id,
      });
    },
    async hasLabel(name) {
      return !!(await labelId(name));
    },
    async createLabel(name) {
      await gql(`mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success } }`, {
        input: { name, teamId: (await teamInfo()).id },
      });
    },
    async hasUser(name) {
      return !!(await userId(name));
    },
    async comment(issue, body) {
      await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
        input: { issueId: await uuid(issue), body },
      });
    },
    async delegate(issue, agent) {
      const id = await userId(agent);
      if (!id) throw new Error(`no Linear user or agent named ${agent}`);
      await update(issue, { delegateId: id });
    },
    async hasPipeline(name) {
      return !!(await pipeline(name));
    },
    async createPipeline(name) {
      // Scheduled, not continuous: a continuous pipeline has only a
      // "Released" stage, so a Release created in it is born completed, and
      // nothing can be added to it.
      await gql(`mutation($input: ReleasePipelineCreateInput!) { releasePipelineCreate(input: $input) { success } }`, {
        input: { name, type: "scheduled", teamIds: [(await teamInfo()).id] },
      });
    },
    async hasRelease(name) {
      return !!(await releaseId(name));
    },
    async createRelease({ name, description, pipeline: pipelineName }) {
      const p = await pipeline(pipelineName);
      if (!p) throw new Error(`no Linear release pipeline ${pipelineName}`);
      if (p.type !== "scheduled") {
        throw new Error(`release pipeline ${pipelineName} is ${p.type}: a Release created in it is born completed, so name a scheduled one`);
      }
      await gql(`mutation($input: ReleaseCreateInput!) { releaseCreate(input: $input) { success } }`, {
        input: { name, description, pipelineId: p.id },
      });
    },
    async addToRelease(issue, release) {
      const id = await releaseId(release);
      if (!id) throw new Error(`no open Linear release ${release}`);
      await gql(`mutation($input: IssueToReleaseCreateInput!) { issueToReleaseCreate(input: $input) { success } }`, {
        input: { issueId: await uuid(issue), releaseId: id },
      });
    },
  };
}
