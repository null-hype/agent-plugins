// CIT-518: deterministic, read-only planning inputs. A failed/partial read
// fails planning; it must never look like an initiative has no feedback.
import { createHash } from "node:crypto";

export const BOOTSTRAP_INITIATIVES = ["be78729c-779b-457c-b514-f88dddd55e0a"];
export const MAX_CONTEXT_BYTES = 200_000;
const MAX_SOURCES = 100;

export interface InitiativeSource {
  id: string;
  initiativeId: string;
  kind: "description" | "update";
  url: string;
  updatedAt: string;
  revision: string;
  body: string;
}

export interface InitiativeContext {
  id: string;
  name: string;
  url: string;
  projects: { id: string; name: string; url: string }[];
  sources: InitiativeSource[];
}

interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}
interface InitiativeNode {
  id: string; name: string; url: string; updatedAt: string;
  description: string | null; content: string | null;
  projects: Page<{ id: string; name: string; url: string }>;
}
interface UpdateNode { id: string; url: string; updatedAt: string; body: string }

export const INITIATIVE_QUERY = `query PlanningInitiative($id: String!, $after: String) {
  initiative(id: $id) {
    id name url updatedAt description content
    projects(first: 100, after: $after, includeArchived: true) {
      nodes { id name url } pageInfo { hasNextPage endCursor }
    }
  }
}`;
export const UPDATES_QUERY = `query PlanningUpdates($id: String!, $after: String) {
  initiative(id: $id) {
    id initiativeUpdates(first: 50, after: $after, includeArchived: true) {
      nodes { id url updatedAt body } pageInfo { hasNextPage endCursor }
    }
  }
}`;

export function sourceRevision(body: string, updatedAt: string): string {
  return createHash("sha256").update(JSON.stringify([body, updatedAt])).digest("hex");
}

function cursor<T>(page: Page<T>, seen: Set<string>): string | null {
  if (!page.pageInfo.hasNextPage) return null;
  const next = page.pageInfo.endCursor;
  if (!next || seen.has(next)) throw new Error("initiative pagination did not advance");
  seen.add(next);
  return next;
}

export function checkContextSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_CONTEXT_BYTES) {
    throw new Error(`initiative context exceeds ${MAX_CONTEXT_BYTES} bytes; narrow the configured initiatives or explicitly reconcile history`);
  }
}

export async function initiativeContext(apiKey: string, ids = BOOTSTRAP_INITIATIVES, fetcher = fetch): Promise<InitiativeContext[]> {
  if (!ids.length || ids.length > 8 || ids.some((id) => !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))) {
    throw new Error("planning requires 1–8 explicit initiative UUIDs");
  }
  const query = async <T>(query: string, id: string, after: string | null): Promise<T> => {
    const res = await fetcher("https://api.linear.app/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables: { id, after } }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json() as { data?: { initiative: T }; errors?: unknown };
    if (!res.ok || body.errors || !body.data?.initiative) {
      throw new Error(`initiative read failed (${res.status}) for ${id}: ${JSON.stringify(body.errors ?? body)}`);
    }
    return body.data.initiative;
  };
  const contexts: InitiativeContext[] = [];
  let sourceCount = 0;
  for (const id of [...new Set(ids.map((id) => id.toLowerCase()))].sort()) {
    const node = await query<InitiativeNode>(INITIATIVE_QUERY, id, null);
    if (node.id !== id) throw new Error(`initiative read returned the wrong id for ${id}`);
    const projects = [...node.projects.nodes];
    const seenProjects = new Set<string>();
    let after = cursor(node.projects, seenProjects);
    while (after) {
      const next = await query<InitiativeNode>(INITIATIVE_QUERY, id, after);
      if (next.id !== id || next.updatedAt !== node.updatedAt) throw new Error(`initiative ${id} changed while paging projects; retry planning`);
      projects.push(...next.projects.nodes);
      if (projects.length > 100) throw new Error(`initiative ${id} exceeds 100 projects`);
      after = cursor(next.projects, seenProjects);
    }
    if (new Set(projects.map((p) => p.id)).size !== projects.length) throw new Error(`duplicate initiative project in ${id}`);
    const source = (kind: InitiativeSource["kind"], s: UpdateNode): InitiativeSource => {
      if (!s.id || !s.url || !s.updatedAt || typeof s.body !== "string") throw new Error(`incomplete initiative source in ${id}`);
      return { ...s, initiativeId: id, kind, revision: sourceRevision(s.body, s.updatedAt) };
    };
    const sources = [source("description", {
      id: `initiative:${id}`, url: node.url, updatedAt: node.updatedAt,
      body: [node.name, node.description, node.content].filter(Boolean).join("\n\n"),
    })];
    const context = { id, name: node.name, url: node.url, projects: projects.sort((a, b) => a.id.localeCompare(b.id)), sources };
    contexts.push(context);
    sourceCount++;
    const seenUpdates = new Set<string>();
    after = null;
    do {
      const page: { id: string; initiativeUpdates: Page<UpdateNode> } = await query(UPDATES_QUERY, id, after);
      if (page.id !== id) throw new Error(`initiative updates returned the wrong id for ${id}`);
      sources.push(...page.initiativeUpdates.nodes.map((n) => source("update", n)));
      sourceCount += page.initiativeUpdates.nodes.length;
      if (sourceCount > MAX_SOURCES) throw new Error(`initiative context exceeds ${MAX_SOURCES} sources; nothing was truncated`);
      checkContextSize(contexts);
      after = cursor(page.initiativeUpdates, seenUpdates);
    } while (after);
    sources.sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(sources.map((s) => s.id)).size !== sources.length) throw new Error(`duplicate initiative source in ${id}`);
  }
  checkContextSize(contexts);
  return contexts;
}
