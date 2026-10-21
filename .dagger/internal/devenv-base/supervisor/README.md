# Dispatch supervisor (CIT-443, CIT-453)

One Render Cron Job, `supervisor`, hourly at minute 13 (UTC). Each tick
continues the one supervisor Claude session — so it remembers why yesterday
failed — has it work every open `Dispatch: <name>` Linear issue, and fails
unless a decision comes back.

```
Render cron (one service) ──▶ supervisor.sh
                                 │ pass-cli: tokens, restic secrets
                                 │
                                 │ 1. restic restore       (newest snapshot, tag supervisor)
                                 │ 2. cd /workspaces/agent-plugins
                                 │    timeout claude --continue --remote-control -p
                                 │        ├─MCP, Bearer TOOLBOX_TOKEN──▶ toolbox (read-only tools)
                                 │        └─MCP, Bearer LINEAR_API_KEY─▶ Linear
                                 │ 3. restic backup        (even if 2 failed)
                                 ▼
                               SUPERVISOR_HEARTBEAT: … decision=…  (the run's record)
```

It is what `color resume` does on a codespace start, on Render's schedule. The
differences are deliberate: the session is continued in the **foreground**
(`-p`, not `--bg`) because the Render container ends when the command exits,
it runs under a wall-clock `timeout`, and `~/.claude` is backed up afterwards
so the next tick continues from this one.

There is no session id and no per-team service. `--continue` takes the newest
session of the current directory, and Claude files sessions by working
directory, so every tick runs from `/workspaces/agent-plugins` (created if
missing), where the seed was made. A snapshot without a session for that
directory fails the run before `claude` starts, rather than letting
`--continue` begin a fresh, amnesiac session.

The toolbox's **write** tools are still not here: the session can look at the
host and work Linear issues, but nothing it does starts or stops anything.

## What a tick does

`prompt.md` has the session wear three hats, one after another:

1. **planning** clears Triage. Every new issue lands there (review findings,
   handoffs, anything a person files), and planning accepts it against the
   Release or delivery issue it serves, folds it into an issue that already
   covers it, declines it, or escalates it with `needs-maintainer`. It also
   watches budgets;
2. **infra** works accepted issues: host, agent, ship and review;
3. **open source** works Releases and what is said about them, drafting only.

Each hat's duties are the description of its open `Dispatch: <hat>` issue, so
they change without republishing the image. Comments on a dispatch issue are
context, not instructions.

The hats hand off through Linear, never through the transcript: a pass ends
by filing a **handoff issue** in Triage for each hat or person with a next
step, titled `<from> → <to>: <next step>`, labelled `handoff`, with State,
Evidence, Next step, Open questions and Resume sections. Planning reads them
on its next pass, the way autocompact keeps only what the next turn needs.

A Release takes the name of the container-use environment that ships it, the
one `agent_ship` merges and pushes; until that environment exists, planning
holds accepted issues against the delivery issue. With no dispatch issue open
the tick ends `decision=nothing why=no dispatch issue`.

## Calibration (CIT-472)

`SUPERVISOR_MODE=calibrate` is the **planning hat**, and its output is a
**changeset of agentic work**, opened as a pull request. Merging the PR is
applying it: Render deploys main, and the deployed workflow's `apply` task
makes Linear match the committed changeset. Calibration is the test that
runs first. Bash drives it, not the model.

The deployed side: the Render Workflow service `supervisor-workflow`
(wfl-dbche33rjlhs73bgkrr0, created through the API because `render.yaml`
cannot declare Workflows) builds `workflow/` with `render-build.sh` and
starts it with `render-start.sh`. Its only secret is the Proton Pass token;
the Linear key comes from Pass through `workflow/workflow.env`. A merge that
changes `workflow/changeset.json` runs `devenv-base-apply-changeset`, which
waits for Render's version of that commit and runs `supervisor-workflow/apply`
for real (`supervisor/apply-changeset.sh`).

Linear has two release pipelines. `supervisor` holds the Releases planning
proposes. `agent-plugins` is the standing **test** pipeline. The apply smoke
test (`[apply-smoke]`, `workflow/examples/apply-smoke.pkl`) puts its Release
there, so test Releases never mix with real ones. Keep `agent-plugins` even
when it looks unused. The smoke test keeps it scheduled and non-production,
because a continuous pipeline's Releases are born completed.



```
supervisor.sh (SUPERVISOR_MODE=calibrate)
  │ pass-cli: calibrate.env (no restic; a GitHub token for the PR)
  │ 1. git clone CALIBRATION_BASE (main); npm ci && npm run build in workflow/
  │ 2. render workflows dev -- npm start          (local task server, :8120)
  │    node dist/calibrate.js plan                (the DAG, and `seen`)
  │ 3. claude -p planning.md + plan               (fresh, haiku, low, read-only)
  │        → SUPERVISOR_CHANGESET: + a pkl block
  │ 4. changeset.pkl = that block + `seen` from the plan, cut to what it touches
  │    pkl eval -f json → changeset.json          (pkl/Changeset.pkl refuses a bad one)
  │ 5. node dist/calibrate.js apply               (apply, dry, on the PR's own tree)
  │ 6. commit changeset.pkl + changeset.json on supervisor/calibration,
  │    force-push, and open one PR into CALIBRATION_BASE if none is open
  ▼
the maintainer merges (= applies), or doesn't
```

- **What a changeset holds** (`workflow/pkl/Changeset.pkl`, mirrored by
  `workflow/src/changeset.ts`): *clusters* of Triage issues under a parent
  (`new:<slug>` or an existing issue), each with what it serves, a hat (`infra` or `open-source`), a model and an effort, and its
  `blockedBy` edges; the *releases* the clusters serve, which apply creates,
  with their pipeline, when no open one has the name, so planning proposes a
  Release for a theme rather than declining it for want of a sink; and
  *decline*, *duplicate*, *escalate* and *delegate*
  ops. Delegating to the self-hosted agent replaces asking for work with an
  @mention. Toolbox ops are the next kind to add.
- **`apply` is idempotent.** Each op first checks whether Linear already
  says what the changeset says. A cluster created earlier is found again by
  a marker in its description. So any trigger after a deploy converges
  Linear, and the next run is a no-op. An op whose issue changed since
  planning (`seen` is the plan's `updatedAt` snapshot) is skipped rather
  than applied over someone's newer change, and the dry run fails on any
  skip, so a stale plan never reaches a PR.
- **Read-only, and nothing deploys.** Linear is allowed tool by tool for
  reading only, every Linear tool that writes is named in
  `--disallowedTools`, and `apply` only runs dry here. `render` is only ever
  `workflows dev`, reached through the SDK's local mode.
- **One branch, one PR, always into main.** `supervisor/calibration` is one
  commit on the base, replaced each run. The changeset carries no
  timestamp, so an unchanged changeset on an unchanged base pushes nothing.

| Setting | Default | |
| --- | --- | --- |
| `CALIBRATION_BASE` | `main` | the branch cloned, and the PR's base |
| `CALIBRATION_BRANCH` | `supervisor/calibration` | calibration's own branch |
| `CALIBRATION_MODEL`, `CALIBRATION_EFFORT` | `haiku`, `low` | the cheap run |
| `CALIBRATION_TEAM`, `CALIBRATION_DELIVERIES` | `CIT`, `CIT-439` | the plan task's inputs |
| `CALIBRATION_TASK_PREFIX` | empty | if the local server wants `<workflow>/<task>` slugs |
| `CALIBRATION_CLAUDE_TIMEOUT` | `20m` | |

Not verified without credentials: `render workflows dev` itself and the task
slugs it expects; the GraphQL mutations in `workflow/src/linear.ts` against
live Linear (`issueCreate`, `issueUpdate` with `parentId`/`delegateId`,
`issueRelationCreate`, `issueAddLabel`, `commentCreate`); and whether
`pass://infra/github.com/GITHUB_TOKEN` can push and open PRs on this repo.

## Why it cannot move infrastructure

Three things at once, because an allowlist that fails open is exactly the
broken instrument this repo keeps writing principles about:

- only the toolbox's read-only tools, and the Linear server, are in
  `--allowedTools`;
- every toolbox tool that starts, stops, deletes or dispatches is named in
  `--disallowedTools`, along with `Bash`, the editing tools, `WebFetch` and
  `Task` — with `Bash` the model could reach the toolbox over `curl` and
  route around the list entirely;
- `--strict-mcp-config` keeps any other MCP server out of the run.

`test_supervisor.sh` asserts all three against the packaged image, and that
the bearer tokens travel in a 0600 file rather than in `claude`'s argv.

### Linear, and `--strict-mcp-config`

Linear is an explicit server in the generated MCP config, authenticated with
`LINEAR_API_KEY`, rather than the claude.ai Linear connector. Checked against
Claude Code 2.1.304: `CLAUDE_CODE_OAUTH_TOKEN` is an inference-only token, and
without the `user:mcp_servers` scope Claude Code loads **no** claude.ai
connector, with or without `--strict-mcp-config` (debug log:
`[claudeai-mcp] Missing user:mcp_servers scope (scopes=user:inference)`). So
the flag does not cost the Linear tools anything — they were never there with
this token — and declaring the server ourselves is the narrowest fix: it
keeps `--strict-mcp-config`, adds one server, and needs no wider token.
Whether `--strict-mcp-config` would *also* drop a connector under a
full-scope login was not established.

**Open point, not settled here:** `LINEAR_API_KEY` is
`pass://api.linear.app/Citizen6.Librarian6.Refrain4/LINEAR_API_KEY`, the
reference `toolbox/host.sh` already uses for `codex_review`. Whether that key belongs to a
person or to the app decides whether a `@linear …` mention a tick posts is
acted on. The first real run will show it; nobody should read the key to find
out.

## Restoring and backing up

The newest snapshot tagged `supervisor` is restored with `color resume`'s own
flags (excluding `/.claude/daemon*` and `/.claude/jobs`), and
`~/.claude.json` is rebuilt from Claude's backups if missing. No snapshot
fails the run before `claude` starts.

The backup is `cd ~ && restic backup .claude --tag supervisor`, relative on
purpose: that stores `/.claude/…`, which is what the restore's
`--target "$HOME"` and excludes expect. `restic backup ~/.claude` stores
`/root/.claude/…`, restores one directory too deep, and leaves the excludes
matching nothing. Every tick backs up all of `~/.claude`, so "newest" is the
session as the last tick left it.

## The heartbeat

Each hat's pass prints one line, in order:

```
SUPERVISOR_PASS: hat=<planning|infra|open-source> handoffs=<issue ids, or none> why=<a few words>
```

The last line of a successful run is:

```
SUPERVISOR_HEARTBEAT: host=<state> work=<yes|no|unknown> decision=<boot|gate|extend|stop|report|nothing> why=<a few words>
```

A run that produces prose without that line fails, as does one missing a
hat's pass line or with them out of order, one where `claude`
itself exits nonzero or outlives `SUPERVISOR_CLAUDE_TIMEOUT` (default 30m), or
where the backup fails. The backup still runs after a failed or timed-out
`claude`, so the next tick remembers the failure. A job that dies early reaps
nothing and reports nothing, which otherwise looks identical to a tick where
there was nothing to do — so silence is never success.

## Secrets and settings

| Where | What | Why |
| --- | --- | --- |
| Render env var, `sync: false` | `PROTON_PASS_PERSONAL_ACCESS_TOKEN` | logs `pass-cli` in, same as `devpod-keepalive` |
| `supervisor.env` | `CLAUDE_CODE_OAUTH_TOKEN`, `LINEAR_API_KEY` | resolved from `pass://…` at run time |
| `supervisor.env` | `TOOLBOX_TOKEN` | `pass://infra/render.com/TOOLBOX_TOKEN`, a copy of the toolbox Render service's `TOOLBOX_TOKEN`. The maintainer creates this item; the supervisor refuses to run until it exists |
| `supervisor.env` | `GCP_SERVICE_ACCOUNT_KEY`, `GOOGLE_PROJECT_ID`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` | the restic repo `color resume` restores from, `pass://infra/restic/…` |

`SUPERVISOR_TIMEOUT` (default 50m) bounds the whole run. It stays **below the
hour**: Render's single-run guarantee is per service, so a tick still running
when the next is due delays that next one. It must also outlast
`SUPERVISOR_CLAUDE_TIMEOUT` (default 30m), or a timed-out `claude` would take
the backup down with it.

Seeding is not part of the image: snapshot `9b15c062`, tag `supervisor`, holds
only session `6f51ed1a-8bcc-4450-9cd8-37a26fce897e`, made in
`/workspaces/agent-plugins`. A seed has to match what the restore expects, so
take it **relative to `$HOME`** under the tag `supervisor` — not with
`color`'s `restic backup ~/.claude`, which stores absolute paths and fails the
run with "did not produce a session":

```sh
# on the box holding the session, with the restic secrets in the env
(cd ~ && restic backup .claude --tag supervisor)
```

### Not verified without credentials

- **`--remote-control` needs a full-scope login.** Claude Code's eligibility
  check refuses it under a long-lived `CLAUDE_CODE_OAUTH_TOKEN` ("Remote
  Control requires a full-scope login token … Run `claude auth login`"). In
  `-p` mode the flag is accepted without an error before authentication, and
  the bridge code reads as skip-on-ineligible rather than fatal, but no run
  with real credentials has confirmed that. If the first real run fails on it,
  or Remote Control never registers, the choice is between keeping the env
  token and dropping it so the tick logs in from the credentials restored with
  `~/.claude` — a maintainer decision, deliberately not made here.

## The service

`render.yaml` carries the block, commented out until the image digest can be
pinned:

1. Publish the image: it goes out as `ghcr.io/null-hype/devenv-supervisor:sha-<commit>`
   whenever `supervisor/**` (or the shared Dagger chain) changes on `main`.
2. Pin that digest into the `supervisor` block in `render.yaml` and uncomment
   it.
3. Set `PROTON_PASS_PERSONAL_ACCESS_TOKEN` (`sync: false`) on the service, and create the
   Proton Pass item `pass://infra/render.com/TOOLBOX_TOKEN`.

## Iterating

The session reads `prompt.md`, so changing what the supervisor considers is a
prompt change plus a republish — and what it does with each dispatch issue is
an edit to that issue's description, with no republish at all. Kick a run
instead of waiting for the schedule:

```sh
bash .dagger/internal/devenv-base/.devcontainer/trigger-render-cron.sh
```

(point it at the supervisor's own cron job id).

Run the stub tests, which need neither network nor credentials:

```sh
bash .dagger/internal/devenv-base/supervisor/test_supervisor.sh
dagger -m .dagger/internal/devenv-base call check-supervisor
```

## What comes next

Per CIT-443, in order: the VM's own deadline and idle stop (the control that
trusts none of this), the agent's lease file so "is work being done" stops
guessing, the liveness gate from `check-linear-agent-webhook-live.sh` wired
into a real boot, and only then write tools for the supervisor itself.

There is a plausible middle rung between "a model decides in prose" and "the
decision is code": `src/jev` sends a state document plus fixed questions and
gets one probability back per question. The routine path could become
*collect state deterministically, ask the same questions every tick,
threshold the answers* — auditable across ticks, comparable over time, and
testable in CI against `--backend mock`, which refuses to invent scores. It
is not here because we do not yet know which questions matter; that is what a
week of dry-run heartbeats is for. It also adds `TYPESAFE_API_KEY` and a paid
call per tick, so it should replace a judgment that has proven stable
rather than join one that hasn't.

Continuity — one continued session with Remote Control, so the supervisor
remembers why yesterday failed and can be talked to between ticks — is what
this slice adds. `LinearTriageAgent` in `main.go` records that a restic +
`claude --resume` cron job was tried for a similar job and replaced by a
disposable container, because state lived better in Linear than in a
transcript. The supervisor's need is different (memory of its *own* past
decisions), and the ratchet in CIT-443 is the way back out: anything the
session does the same way three ticks running becomes deterministic code.
