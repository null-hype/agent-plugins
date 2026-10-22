# The supervisor (CIT-443, CIT-472)

One Render Cron Job, `supervisor`, hourly at minute 13 (UTC). Each run
continues the one supervisor Claude session, so it remembers why the last run
failed. The session looks at everything, with the Duo editor first, and its
whole output is a **changeset**: what Linear should look like next. The run
checks that changeset on the workflow's dev server and opens it as a pull
request, which merges itself once its checks are green. The run then starts
the deployed workflow's apply on Render. Merging is applying.

```
Render cron `supervisor` ──▶ supervisor.sh
  │ pass-cli: supervisor.env (tokens, restic, the GitHub token)
  │ 1. restic restore                       (newest snapshot, tag supervisor)
  │ 2. git clone main; npm ci && npm run build in workflow/
  │    render workflows dev -- npm start    (local task server, :8120)
  │    node dist/calibrate.js plan          (the open issues, back from the Releases)
  │ 3. cd /workspaces/agent-plugins
  │    claude --continue --remote-control -p prompt.md + plan   (sonnet, medium)
  │        ├─MCP, Bearer TOOLBOX_TOKEN──▶ toolbox (read-only tools)
  │        └─MCP, Bearer LINEAR_API_KEY─▶ Linear (read tools only)
  │        → SUPERVISOR_CHANGESET: + a pkl block
  │ 4. changeset.pkl = that block + `seen`; pkl eval → changeset.json
  │    (pkl/Changeset.pkl refuses a bad one; the session gets one more go)
  │ 5. node dist/calibrate.js apply         (apply, dry, on the PR's own tree)
  │ 6. push supervisor/calibration, open or update the PR,
  │    wait for its checks, merge on green
  │ 7. apply-changeset.sh start <merged commit>
  │      └─ Render API ──▶ supervisor-workflow/apply ──▶ Linear, host
  │ 8. restic backup                        (whatever happened above)
  ▼
next run: apply-changeset.sh status <run>; a failed apply is started again
```

It is what `color resume` does on a codespace start, on Render's schedule.
The session is continued in the **foreground** (`-p`, not `--bg`) because the
Render container ends when the command exits, it runs under a wall-clock
`timeout`, and `~/.claude` is backed up afterwards so the next run continues
from this one.

There is no session id. `--continue` takes the newest session of the current
directory, and Claude files sessions by working directory, so every run works
from `/workspaces/agent-plugins`, where the seed was made. A snapshot without
a session for that directory fails the run before `claude` starts, rather
than letting `--continue` begin a fresh, amnesiac session.

The session changes nothing itself: it reads Linear and the toolbox, and
everything it wants done goes into the changeset. Implementation is handed to
the self-hosted Linear agent, `Claude`, by a `delegate` op, and its finished
container-use environment is shipped by a `ship` op. Applying either wakes the
host first, through the toolbox, with no model. The hourly run opens a PR for
every recent `cit-<n>-…` branch that has commits main lacks and no PR, so
shipped work is reviewed rather than left on a branch.

The deployed side: the Render Workflow service `supervisor-workflow`
(wfl-dbche33rjlhs73bgkrr0, created through the API because `render.yaml`
cannot declare Workflows) builds `workflow/` with `render-build.sh` and
starts it with `render-start.sh`. Its only secret is the Proton Pass token;
the Linear key comes from Pass through `workflow/workflow.env`. Once the
run's changeset PR merges, the same run waits for Render's version of the
merged commit and starts `supervisor-workflow/apply` on it for real
(`supervisor/apply-changeset.sh start`). It does not wait for the apply,
which may first spend 15 minutes waking the host. The task run's id is kept
in `~/.claude/supervisor-apply`, so the next run checks it
(`apply-changeset.sh status`) and starts a failed apply, or main when there
is no record, again. Apply is idempotent.
Applying makes no model calls, and nothing on GitHub is involved.

Never disable, suspend or delete the cron or the Render Workflow without the
maintainer's explicit OK.

A merge that changes the supervisor image publishes it and deploys it to the
cron by digest (`devenv-base-publish`, `deploy-supervisor`): setting the
cron's image alone does not deploy it. The prompt is read from main's
checkout each run, so a prompt change needs no new image.

The workflow's per-cluster `execute` sessions are gone: the session's changeset
delegates implementation to the agent and ships finished work, and apply does
both without a model.

`SUPERVISOR_MODE=calibrate` runs the same pipeline as a one-off: a fresh
session with no restic and no Remote Control, on a cheap model, whose PR is
only proposed (`CALIBRATION_MERGE=1` merges it on green). It resolves
`calibrate.env` instead of `supervisor.env`.

Linear has two release pipelines. `supervisor` holds the Releases planning
proposes. `agent-plugins` is the standing **test** pipeline. The apply smoke
test (`[apply-smoke]`, `workflow/examples/apply-smoke.pkl`) puts its Release
there, so test Releases never mix with real ones. Keep `agent-plugins` even
when it looks unused. The smoke test keeps it scheduled and non-production,
because a continuous pipeline's Releases are born completed.

- **What a changeset holds** (`workflow/pkl/Changeset.pkl`, mirrored by
  `workflow/src/changeset.ts`): *clusters* of Triage issues under a parent
  (`new:<slug>` or an existing issue), each with what it serves and its
  `blockedBy` edges; the *releases* the clusters serve, which apply creates,
  with their pipeline, when no open one has the name, so planning proposes a
  Release for a theme rather than declining it for want of a sink; and
  *decline*, *done*, *duplicate*, *escalate*, *delegate*, *ship* and *review* ops.
  Every action is an op: nothing asks for work or a tool call with an
  @mention. Delegating fires the agent's session; ship and review call the
  toolbox's `agent_ship` and `codex_review`, after waking the host.
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
- **One branch, one PR, per base.** `supervisor/calibration` is one
  commit on main, replaced each run, for the hourly run and a calibration alike. Calibrating another branch (a `[calibrate]`
  commit) uses `supervisor/calibration-<branch>` instead, so it never replaces
  main's calibration PR. The changeset carries no
  timestamp, so an unchanged changeset on an unchanged base pushes nothing.

| Setting | Default | |
| --- | --- | --- |
| `CALIBRATION_BASE` | `main` | the branch cloned, and the PR's base |
| `CALIBRATION_BRANCH` | `supervisor/calibration`, or `supervisor/calibration-<base>` off main | calibration's own branch |
| `SUPERVISOR_MODEL`, `SUPERVISOR_EFFORT` | `sonnet`, `medium` | the hourly run |
| `CALIBRATION_MODEL`, `CALIBRATION_EFFORT` | `haiku`, `low` | a one-off calibration |
| `CALIBRATION_MERGE` | `1` hourly, `0` for a calibration | merge the PR once its checks are green |
| `CALIBRATION_TEAM`, `CALIBRATION_DELIVERIES` | `CIT`, `CIT-439` | the plan task's inputs |
| `CALIBRATION_TASK_PREFIX` | empty | if the local server wants `<workflow>/<task>` slugs |
| `CALIBRATION_CLAUDE_TIMEOUT` | `20m` | |

Not verified without credentials: `render workflows dev` itself and the task
slugs it expects; the GraphQL mutations in `workflow/src/linear.ts` against
live Linear (`issueCreate`, `issueUpdate` with `parentId`/`delegateId`,
`issueRelationCreate`, `issueAddLabel`, `commentCreate`); and whether
`pass://infra/github.com/GITHUB_TOKEN` can push and open PRs on this repo.

## Why it cannot change anything itself

Three things at once, because an allowlist that fails open is exactly the
broken instrument this repo keeps writing principles about:

- only the toolbox's read-only tools, and Linear's read tools, are in
  `--allowedTools`;
- every toolbox tool that starts, stops, deletes, ships or dispatches, and
  every Linear tool that writes, is named in `--disallowedTools`, along with
  `Bash`, the editing tools, `WebFetch` and
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
reference `toolbox/host.sh` already uses for `codex_review`. Ticks no longer post `@linear …` mentions:
delegation, ships and reviews are changeset ops that apply carries out.

## Restoring and backing up

The newest snapshot tagged `supervisor` is restored with `color resume`'s own
flags (excluding `/.claude/daemon*` and `/.claude/jobs`), and
`~/.claude.json` is rebuilt from Claude's backups if missing. No snapshot
fails the run before `claude` starts.

The backup is `cd ~ && restic backup .claude --tag supervisor`, relative on
purpose: that stores `/.claude/…`, which is what the restore's
`--target "$HOME"` and excludes expect. `restic backup ~/.claude` stores
`/root/.claude/…`, restores one directory too deep, and leaves the excludes
matching nothing. Every run backs up all of `~/.claude`, so "newest" is the
session as the last run left it.

## The last line

A run ends with one of:

```
SUPERVISOR_PLAN: merged pr=<url>      (the hourly run: merged on green, so it applies)
SUPERVISOR_PLAN: proposed pr=<url>    (a calibration: left for a person)
SUPERVISOR_PLAN: unchanged            (main already carries this changeset)
```

A run without a changeset fails, as does one where `claude` itself exits
nonzero or outlives `SUPERVISOR_CLAUDE_TIMEOUT` (default 30m), a changeset that
does not render twice, a failed dry run, red checks, or a failed backup. The
backup still runs after any of those, so the next run remembers the failure.
A job that dies early reaps nothing and reports nothing, which otherwise looks
identical to a run where there was nothing to do, so silence is never success.

## Secrets and settings

| Where | What | Why |
| --- | --- | --- |
| Render env var, `sync: false` | `PROTON_PASS_PERSONAL_ACCESS_TOKEN` | logs `pass-cli` in, same as `devpod-keepalive` |
| `supervisor.env` | `CLAUDE_CODE_OAUTH_TOKEN`, `LINEAR_API_KEY` | resolved from `pass://…` at run time |
| `supervisor.env` | `TOOLBOX_TOKEN` | `pass://infra/render.com/TOOLBOX_TOKEN`, a copy of the toolbox Render service's `TOOLBOX_TOKEN`. The maintainer creates this item; the supervisor refuses to run until it exists |
| `supervisor.env` | `GCP_SERVICE_ACCOUNT_KEY`, `GOOGLE_PROJECT_ID`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` | the restic repo `color resume` restores from, `pass://infra/restic/…` |
| `supervisor.env` | `GITHUB_TOKEN` | `pass://infra/github.com/GITHUB_TOKEN`: pushes the changeset branch, opens the PR and merges it |
| `supervisor.env` | `RENDER_API_KEY` | `pass://infra/render.com/RENDER_API_KEY`: starts the merged changeset's apply on the Render Workflow, and reads how the last one went |

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

The live service is `crn-dbc1s9ss728c73dn3tl0`, which runs the image by
digest. `render.yaml` carries its block, commented out:

1. Publish the image: it goes out as `ghcr.io/null-hype/devenv-supervisor:sha-<commit>`
   whenever `supervisor/**` (or the shared Dagger chain) changes on `main`.
2. Point the service's image at that digest (Render API: `PATCH
   /v1/services/<id>` with `image.imagePath`).
3. Set `PROTON_PASS_PERSONAL_ACCESS_TOKEN` (`sync: false`) on the service, and create the
   Proton Pass item `pass://infra/render.com/TOOLBOX_TOKEN`.

## Iterating

The session reads `prompt.md`, so changing what the supervisor considers is a
prompt change plus a republish, and a new Render image digest on the cron.
Kick a run
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
