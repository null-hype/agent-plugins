import { test } from "node:test";
import assert from "node:assert/strict";
import type { Changeset } from "./changeset.ts";
import type { Plan } from "./dag.ts";
import { checkPass, claudeArgs, prompt, readyClusters, runClaude, toolPolicy, type ReadyCluster } from "./execute.ts";

const cluster = (key: string, over: Partial<Changeset["clusters"][number]> = {}) => ({
  key,
  title: `title of ${key}`,
  description: "",
  hat: "infra" as const,
  model: "sonnet" as const,
  effort: "high" as const,
  serves: "CIT-439",
  blockedBy: [],
  issues: ["CIT-500"],
  ...over,
});

const cs: Changeset = {
  seen: {},
  releases: [],
  clusters: [cluster("new:a"), cluster("CIT-434", { hat: "open-source", model: "haiku", effort: "low" }), cluster("new:b"), cluster("new:unapplied")],
  decline: [],
  duplicate: [],
  escalate: [],
  delegate: [],
};

const plan: Plan = {
  sinks: [],
  order: [
    { id: "CIT-900", title: "", status: "ready", blockedBy: [], serves: [] },
    { id: "CIT-434", title: "", status: "ready", blockedBy: [], serves: [] },
    { id: "CIT-901", title: "", status: "waiting", blockedBy: ["CIT-900"], serves: [] },
  ],
  pruned: [],
  cycles: [],
  seen: {},
  hints: {},
};

test("only clusters whose issue the plan says is ready run, with planning's hat, model and effort", () => {
  const got = readyClusters(plan, cs, { "new:a": "CIT-900", "CIT-434": "CIT-434", "new:b": "CIT-901" });
  assert.deepEqual(
    got.map((c) => `${c.key} ${c.issue} ${c.hat} ${c.model} ${c.effort}`),
    ["new:a CIT-900 infra sonnet high", "CIT-434 CIT-434 open-source haiku low"],
  );
});

const infra: ReadyCluster = { key: "new:a", issue: "CIT-900", title: "Host safety", hat: "infra", model: "sonnet", effort: "high", issues: ["CIT-500", "CIT-501"] };

test("the prompt names the hat, its dispatch issue and the cluster", () => {
  const text = prompt("{{HAT}} {{DISPATCH}} {{CLUSTER}} {{TITLE}} {{ISSUES}} {{NOW}} {{UNKNOWN}}", infra, "T");
  assert.equal(text, "infra CIT-481 CIT-900 Host safety CIT-500, CIT-501 T {{UNKNOWN}}");
});

test("infra may start, stop and ship; open source may only look; nobody may delete or use Bash", () => {
  const i = toolPolicy("infra");
  const o = toolPolicy("open-source");
  for (const t of ["mcp__toolbox__host_start", "mcp__toolbox__host_stop", "mcp__toolbox__agent_ship"]) {
    assert.ok(i.allowed.includes(t) && !i.disallowed.includes(t), `infra should have ${t}`);
    assert.ok(!o.allowed.includes(t) && o.disallowed.includes(t), `open source should be denied ${t}`);
  }
  for (const p of [i, o]) {
    for (const t of ["mcp__toolbox__workspace_delete", "Bash", "Write", "Edit", "WebFetch", "Task"]) {
      assert.ok(p.disallowed.includes(t) && !p.allowed.includes(t), `${t} should be denied`);
    }
  }
});

test("claude gets the model, effort and MCP file, with the tool lists last", () => {
  const args = claudeArgs(infra, "the prompt", "/tmp/mcp.json");
  assert.deepEqual(args.slice(0, 10), ["-p", "the prompt", "--model", "sonnet", "--effort", "high", "--mcp-config", "/tmp/mcp.json", "--strict-mcp-config", "--allowedTools"]);
  assert.ok(args.indexOf("--disallowedTools") > args.indexOf("--allowedTools"));
});

test("a run must end with its own pass line", () => {
  assert.equal(
    checkPass(infra, "worked\nSUPERVISOR_PASS: hat=infra cluster=CIT-900 outcome=handed-off why=host was down\n"),
    "SUPERVISOR_PASS: hat=infra cluster=CIT-900 outcome=handed-off why=host was down",
  );
  assert.throws(() => checkPass(infra, "I did some things"), /printed no SUPERVISOR_PASS line/);
  assert.throws(() => checkPass(infra, "SUPERVISOR_PASS: hat=infra cluster=CIT-1 outcome=done"), /pass line is for infra CIT-1/);
});

test("claude's exit and timeout are failures, with what it said", async () => {
  assert.equal(await runClaude(["-c", "echo hi"], 5000, "sh"), "hi\n");
  await assert.rejects(runClaude(["-c", "echo nope >&2; exit 3"], 5000, "sh"), /exited 3: nope/);
  await assert.rejects(runClaude(["-c", "sleep 5"], 100, "sh"), /was stopped \(SIGTERM\)/);
});
