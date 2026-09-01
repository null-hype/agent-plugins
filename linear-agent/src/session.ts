import type { LinearClient } from "@linear/sdk";
import type { AgentSessionEventWebhookPayload, EntityWebhookPayloadWithIssueData } from "@linear/sdk";
import { runClaude } from "./claude.ts";

/**
 * Tracks the most recent agent session id per issue, keyed by issue id, so a
 * later Issue webhook (e.g. a description edit) can be turned into a prompt
 * on the same thread instead of starting a new session. Populated only from
 * AgentSessionEvent payloads for sessions on this app user, so an issue
 * delegated to someone/something else never ends up here. In-memory and
 * per-process: a restart forgets in-flight sessions, and a completed/errored
 * session is evicted so a later description edit is a no-op rather than
 * reviving a dead thread.
 */
const issueSessions = new Map<string, string>();

const TERMINAL_STATUSES = new Set(["complete", "error"]);

/**
 * Handles one AgentSessionEvent webhook. Must be invoked without the caller
 * awaiting it to completion — a `claude` run takes minutes, and Linear
 * expects a `thought` activity posted within 10 seconds of the session
 * being created. postThought below is the only part callers should await;
 * everything after it runs in the background.
 */
export async function handleAgentSessionEvent(
  payload: AgentSessionEventWebhookPayload,
  linear: LinearClient,
  claudeCodeOAuthToken: string,
): Promise<void> {
  const agentSessionId = payload.agentSession.id;
  const issueId = payload.agentSession.issueId;
  if (issueId) {
    if (TERMINAL_STATUSES.has(payload.agentSession.status)) {
      issueSessions.delete(issueId);
    } else {
      issueSessions.set(issueId, agentSessionId);
    }
  }

  const prompt = await buildPrompt(payload, linear, issueId ?? undefined);
  if (prompt === undefined) {
    // Nothing actionable in this event (e.g. a permission change) — ignore.
    return;
  }

  await runTurn(linear, agentSessionId, prompt, claudeCodeOAuthToken);
}

/**
 * Handles one Issue webhook. Only reacts to an actual description change
 * (`updatedFrom` carries the prior value of every field that changed) on an
 * issue this app user already has a live agent session on — anything else
 * (title/state/assignee edits, an issue this agent was never delegated,
 * create/remove actions) is ignored. There is no `prompted` AgentSessionEvent
 * for this case, so the thought/run/response turn is driven directly here
 * rather than through extractPrompt.
 */
export async function handleIssueEvent(
  payload: EntityWebhookPayloadWithIssueData,
  linear: LinearClient,
  claudeCodeOAuthToken: string,
): Promise<void> {
  if (payload.action !== "update") return;
  if (!payload.updatedFrom || !("description" in payload.updatedFrom)) return;

  const agentSessionId = issueSessions.get(payload.data.id);
  if (!agentSessionId) return;

  const context = await buildIssuePrompt(linear, payload.data.id);
  const prompt = `${context}\n\n---\n\nThe issue description was just updated — see "Description" above for the current text. Re-evaluate your plan in light of the change.`;
  await runTurn(linear, agentSessionId, prompt, claudeCodeOAuthToken);
}

// `created` sessions carry the full formatted context (issue, comments,
// guidance) in promptContext, built by Linear itself -- the same content
// its "Copy as prompt" UI action produces. `prompted` sessions are only
// handed the one new message that triggered them (the just-created prompt
// activity), because each runClaude() call is a brand-new, memoryless
// Claude session -- there is no resume/continue wiring reusing a prior
// turn's context. Left as bare text, a `prompted` turn (or a description
// edit) would see nothing but that one message and no issue context at
// all, which is exactly the "I don't have any prior context" failure mode
// observed live. buildIssuePrompt re-derives Linear's own compacted
// context so every turn is self-contained regardless of the trigger.
async function buildPrompt(
  payload: AgentSessionEventWebhookPayload,
  linear: LinearClient,
  issueId: string | undefined,
): Promise<string | undefined> {
  switch (payload.action) {
    case "created":
      return payload.promptContext ?? undefined;
    case "prompted": {
      const content = payload.agentActivity?.content as { body?: string } | undefined;
      if (!content?.body) return undefined;
      if (!issueId) return content.body;
      const context = await buildIssuePrompt(linear, issueId);
      return `${context}\n\n---\n\nNew message in this thread:\n\n${content.body}`;
    }
    default:
      return undefined;
  }
}

// Re-derives roughly what Linear's own promptContext/"Copy as prompt"
// contains -- issue title, description, and comment thread -- for triggers
// that don't come with it for free. Deliberately not an exact byte-for-byte
// match of Linear's own formatting (which is server-side and not exposed
// via the API); good enough to make a fresh Claude session self-sufficient.
async function buildIssuePrompt(linear: LinearClient, issueId: string): Promise<string> {
  const issue = await linear.issue(issueId);
  const [state, commentsConnection] = await Promise.all([
    issue.state?.catch(() => undefined),
    issue.comments(),
  ]);

  const lines: string[] = [
    `# ${issue.identifier}: ${issue.title}`,
    issue.url,
    `Priority: ${issue.priorityLabel}`,
    ...(state ? [`Status: ${state.name}`] : []),
    "",
    "## Description",
    issue.description ?? "(no description)",
  ];

  if (commentsConnection.nodes.length > 0) {
    lines.push("", "## Comments");
    for (const comment of commentsConnection.nodes) {
      let who = comment.botActor?.name;
      if (!who) {
        try {
          const author = comment.user ? await comment.user : undefined;
          who = author?.name ?? author?.email;
        } catch {
          who = undefined;
        }
      }
      lines.push(`### ${who ?? "unknown"} (${comment.createdAt.toISOString()})`, comment.body, "");
    }
  }

  return lines.join("\n");
}

async function runTurn(
  linear: LinearClient,
  agentSessionId: string,
  prompt: string,
  claudeCodeOAuthToken: string,
): Promise<void> {
  await postActivity(linear, agentSessionId, { type: "thought", body: "On it." });

  try {
    const result = await runClaude(prompt, claudeCodeOAuthToken, (content) =>
      // Best-effort narration: a failed intermediate post shouldn't abort
      // the turn the way a failed final response/error post should.
      postActivity(linear, agentSessionId, content).catch(() => undefined),
    );
    await postActivity(linear, agentSessionId, { type: "response", body: result });
  } catch (err) {
    await postActivity(linear, agentSessionId, {
      type: "error",
      body: err instanceof Error ? err.message : String(err),
    });
  }
}

async function postActivity(
  linear: LinearClient,
  agentSessionId: string,
  content: Record<string, unknown>,
): Promise<void> {
  await linear.createAgentActivity({ agentSessionId, content });
}
