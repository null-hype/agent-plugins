#!/usr/bin/env node
// A read-only MCP server (stdio) with one tool: read an issue's Linear agent
// sessions. The agent answers in its session, not in issue comments, and
// Linear's own MCP has no tool that reads one, so without this planning never
// sees an agent say it is done. Planning calls it for the issue it is deciding
// about, so it reads one transcript in full rather than a window of all of
// them. It only queries; it has no way to write.
import { createInterface } from "node:readline";

const KEY = process.env.LINEAR_API_KEY;
const API = process.env.LINEAR_API_URL || "https://api.linear.app/graphql";

// Linear caps a query's complexity at 10000, and that cost multiplies page
// sizes, so a session list carrying every session's activities is refused.
// The sessions are listed bare, and each one's activities are read in a
// query of their own, filtered by type on Linear's side.
const SESSION = "id status createdAt updatedAt issue { identifier }";
const SAID = ["prompt", "response", "elicitation", "error"];
const PAGE = 50;

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: KEY },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

// Issue.agentSessions is the direct way, but Linear marks it internal; if it
// is refused, page through recent sessions and keep the issue's.
async function sessionsOf(issue) {
  try {
    const data = await gql(
      `query($id: String!) { issue(id: $id) { agentSessions(first: 10) { nodes { ${SESSION} } } } }`,
      { id: issue },
    );
    return data.issue?.agentSessions.nodes ?? [];
  } catch {
    const data = await gql(`{ agentSessions(first: 100, orderBy: updatedAt) { nodes { ${SESSION} } } }`);
    return data.agentSessions.nodes.filter((s) => s.issue?.identifier === issue);
  }
}

async function activitiesOf(session, narration) {
  const out = [];
  let after = null;
  do {
    const data = await gql(
      `query($id: String!, $after: String, $filter: AgentActivityFilter) { agentSession(id: $id) {
        activities(first: ${PAGE}, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor }
          nodes { createdAt content { __typename
            ... on AgentActivityPromptContent { body } ... on AgentActivityResponseContent { body }
            ... on AgentActivityElicitationContent { body } ... on AgentActivityErrorContent { body }
            ... on AgentActivityThoughtContent { body }
            ... on AgentActivityActionContent { action parameter result } } } } } }`,
      { id: session, after, filter: narration ? null : { type: { in: SAID } } },
    );
    const page = data.agentSession.activities;
    out.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return out;
}

function kind(typename) {
  return typename.replace(/^AgentActivity/, "").replace(/Content$/, "").toLowerCase();
}

export async function transcript(issue, narration = false) {
  const sessions = (await sessionsOf(issue)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return Promise.all(
    sessions.map(async (s) => ({
      status: s.status,
      startedAt: s.createdAt,
      updatedAt: s.updatedAt,
      activities: (await activitiesOf(s.id, narration))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(({ createdAt, content: { __typename, ...rest } }) => ({ at: createdAt, type: kind(__typename), ...rest })),
    })),
  );
}

const TOOL = {
  name: "agent_sessions",
  description:
    "Read an issue's Linear agent sessions, newest first: each session's status and what was said in it, in order. " +
    "`prompt` is an ask the agent got, `response` its answer, `elicitation` a question it asked, `error` a failure. " +
    "This is where the delegated agent reports its work (it does not comment on the issue). " +
    "Set narration to also see its thoughts and tool calls.",
  inputSchema: {
    type: "object",
    properties: {
      issue: { type: "string", description: "The issue identifier, like CIT-524." },
      narration: { type: "boolean", description: "Include the agent's thoughts and tool calls." },
    },
    required: ["issue"],
  },
  annotations: { readOnlyHint: true },
};

async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-sessions", version: "1.0.0" },
      };
    case "tools/list":
      return { tools: [TOOL] };
    case "tools/call": {
      const { name, arguments: args = {} } = msg.params ?? {};
      if (name !== TOOL.name) throw new Error(`unknown tool ${name}`);
      try {
        const out = await transcript(String(args.issue ?? ""), Boolean(args.narration));
        return { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] };
      } catch (err) {
        return { content: [{ type: "text", text: String(err?.message ?? err) }], isError: true };
      }
    }
    case "ping":
      return {};
    default:
      throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  createInterface({ input: process.stdin }).on("line", async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id === undefined) return; // a notification
    try {
      send({ jsonrpc: "2.0", id: msg.id, result: await handle(msg) });
    } catch (err) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: err.code ?? -32603, message: String(err.message ?? err) } });
    }
  });
}
