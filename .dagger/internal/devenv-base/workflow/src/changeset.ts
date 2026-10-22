// Planning's output (CIT-472): a changeset of agentic work, the way a
// terraform plan is a changeset to infrastructure. Linear's structure is the
// first kind of op; handing an issue to an agent is the next, and each new
// kind joins as its own section here and its own step in apply.ts. Calibration writes it and never
// applies it; the maintainer reviews it as a PR; the `apply` task makes it
// true on merge. It is declarative: it says what Linear should look like,
// so applying it twice changes nothing the second time.
//
// Every accepted issue serves something published, and a Release is how
// Linear says so. Where no open Release fits a theme, planning proposes one
// rather than declining the theme's issues for want of a sink.
//
// Planning clusters the Triage issues by theme. Each cluster is a parent
// issue (new, or one that already exists) that its members become
// sub-issues of, which moves them out of Triage; it carries the hat, model
// and effort the real run works it with. Whatever is not clustered is
// declined, folded into a duplicate, or escalated. And work that is ready is
// delegated to an agent, which replaces asking for it with an @mention: the
// delegation is the AgentSessionEvent the self-hosted agent acts on.

export const HATS = ["infra", "open-source"] as const;
export const MODELS = ["haiku", "sonnet", "opus"] as const;
export const EFFORTS = ["low", "medium", "high"] as const;

export type Hat = (typeof HATS)[number];

export const RELEASE_PREFIX = "release:";

// A Release the changeset needs. Apply finds an open Release of this name or
// creates it, and the pipeline with it, so naming one that already exists
// changes nothing.
export interface Release {
  name: string;
  description: string;
  // The release pipeline, by name.
  pipeline: string;
}

export interface Cluster {
  // `new:<slug>` creates the parent on apply; an identifier (CIT-465) reuses
  // an open issue as the parent.
  key: string;
  title: string;
  description: string;
  hat: Hat;
  model: (typeof MODELS)[number];
  effort: (typeof EFFORTS)[number];
  // What the cluster delivers into: `release:<name>`, a Release in the
  // changeset's `releases`, which the cluster parent is added to; or a
  // delivery issue like CIT-439, which becomes its parent.
  serves: string;
  // Other clusters (by key) or issues that must finish first.
  blockedBy: string[];
  // The issues that become its sub-issues.
  issues: string[];
}

export interface Changeset {
  // updatedAt of every existing issue the changeset touches, as planning
  // saw it. An issue that has changed since is drift: apply leaves it alone.
  seen: Record<string, string>;
  releases: Release[];
  clusters: Cluster[];
  decline: { issue: string; reason: string }[];
  duplicate: { issue: string; of: string }[];
  escalate: { issue: string; question: string }[];
  // An issue (or a cluster, by key) handed to an agent, by its Linear name.
  delegate: { issue: string; agent: string }[];
  // A finished container-use environment to ship to its issue's branch.
  // Optional: changesets written before it had none.
  ship?: { issue: string; env: string }[];
}

const NEW_KEY = /^new:[a-z0-9]+(-[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Z][A-Z0-9]*-[0-9]+$/;

// Every problem with the changeset, or none. A changeset with any problem is
// not applied at all, and fails the calibration that wrote it.
export function validate(cs: Changeset): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  const placed = new Map<string, string>();
  const place = (issue: string, where: string) => {
    if (!IDENTIFIER.test(issue)) problems.push(`${where}: ${issue} is not an issue identifier`);
    else if (!(issue in cs.seen)) problems.push(`${where}: ${issue} was not seen by planning`);
    const before = placed.get(issue);
    if (before) problems.push(`${issue} is in both ${before} and ${where}`);
    placed.set(issue, where);
  };

  const releases = new Set<string>();
  for (const r of cs.releases) {
    if (!r.name?.trim()) problems.push("a release has no name");
    else if (releases.has(r.name)) problems.push(`release ${r.name} appears twice`);
    releases.add(r.name);
    if (!r.pipeline?.trim()) problems.push(`release ${r.name} names no pipeline`);
  }
  const used = new Set<string>();

  for (const c of cs.clusters) {
    if (keys.has(c.key)) problems.push(`cluster ${c.key} appears twice`);
    keys.add(c.key);
    if (!NEW_KEY.test(c.key) && !IDENTIFIER.test(c.key)) {
      problems.push(`cluster ${c.key}: the key must be new:<slug> or an issue identifier`);
    }
    if (IDENTIFIER.test(c.key) && !(c.key in cs.seen)) {
      problems.push(`cluster ${c.key}: an existing parent must be one planning saw`);
    }
    if (!c.title?.trim()) problems.push(`cluster ${c.key} has no title`);
    if (!(HATS as readonly string[]).includes(c.hat)) problems.push(`cluster ${c.key}: hat ${c.hat} is not infra or open-source`);
    if (!(MODELS as readonly string[]).includes(c.model)) problems.push(`cluster ${c.key}: model ${c.model} is not one of ${MODELS.join(", ")}`);
    if (!(EFFORTS as readonly string[]).includes(c.effort)) problems.push(`cluster ${c.key}: effort ${c.effort} is not one of ${EFFORTS.join(", ")}`);
    if (c.serves.startsWith(RELEASE_PREFIX)) {
      const name = c.serves.slice(RELEASE_PREFIX.length);
      used.add(name);
      if (!releases.has(name)) problems.push(`cluster ${c.key}: serves ${c.serves}, which is not in releases`);
    } else if (!IDENTIFIER.test(c.serves)) {
      problems.push(`cluster ${c.key}: serves must be release:<name> or an issue identifier, got ${c.serves}`);
    }
    if (!c.issues.length) problems.push(`cluster ${c.key} has no issues`);
    for (const i of c.issues) place(i, `cluster ${c.key}`);
  }
  for (const name of releases) {
    if (!used.has(name)) problems.push(`release ${name} is served by no cluster`);
  }
  for (const c of cs.clusters) {
    for (const b of c.blockedBy) {
      if (!keys.has(b) && !IDENTIFIER.test(b)) problems.push(`cluster ${c.key}: blockedBy ${b} is neither a cluster nor an issue`);
      if (b === c.key) problems.push(`cluster ${c.key} blocks itself`);
    }
  }
  for (const d of cs.decline) {
    place(d.issue, "decline");
    if (!d.reason?.trim()) problems.push(`decline ${d.issue} has no reason`);
  }
  for (const d of cs.duplicate) {
    place(d.issue, "duplicate");
    if (!IDENTIFIER.test(d.of)) problems.push(`duplicate ${d.issue}: ${d.of} is not an issue identifier`);
    if (d.of === d.issue) problems.push(`duplicate ${d.issue} is a duplicate of itself`);
  }
  for (const e of cs.escalate) {
    place(e.issue, "escalate");
    if (!e.question?.trim()) problems.push(`escalate ${e.issue} has no question`);
  }
  const delegated = new Set<string>();
  for (const d of cs.delegate) {
    if (delegated.has(d.issue)) problems.push(`delegate ${d.issue} appears twice`);
    delegated.add(d.issue);
    if (!keys.has(d.issue) && !(IDENTIFIER.test(d.issue) && d.issue in cs.seen)) {
      problems.push(`delegate ${d.issue} is neither a cluster nor an issue planning saw`);
    }
    if (!d.agent?.trim()) problems.push(`delegate ${d.issue} names no agent`);
    const closing = placed.get(d.issue);
    if (closing && !closing.startsWith("cluster")) problems.push(`delegate ${d.issue} is also in ${closing}`);
  }
  for (const s of cs.ship ?? []) {
    if (!(s.issue in cs.seen)) problems.push(`ship ${s.issue} was not seen by planning`);
  }
  return problems;
}
