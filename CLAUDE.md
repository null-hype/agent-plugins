# bountybench-dagger-* modules

## Roles

This effort has a fixed chain of delegation. Know which link you are before
following any section below:

```
you (human)
  └─ top-level interactive session (Sonnet, this session when run
     interactively) — the conductor: guides/kicks off the automated
     worker+supervisor loop below, and separately owns the entire Codex
     and Jules relationships (creates delegations, reads their replies —
     Linear for Codex, session activity/API for Jules — pulls PRs locally,
     relays pass/fail feedback back to each). No other link talks to Codex,
     Linear, or Jules directly.
       ├─ supervisor pass (Sonnet, automated, hourly via bountybench-loop) —
       │    verifies and merges all lanes' work; never creates work itself
       │      └─ advisor (Opus, on-demand) — second opinion on ambiguous
       │         merge/conflict calls only
       └─ worker pass (Haiku, automated, hourly via bountybench-loop) —
            does the mechanical per-app container-use bootstrapping
```

Codex and Jules both sit outside this chain as external delegates, reachable
only through the top-level session — see "Delegated-agent lanes" below.
This distinction exists because it's load-bearing, not decorative: an
earlier attempt to have an automated Haiku script create Codex delegations
via a `claude.ai` Linear connector failed outright (the connector is
account-OAuth-mediated and doesn't attach to a headless SDK `query()` run)
— confirming that delegating to an external agent is specifically a
top-level-session responsibility, not something to push down into the
automated loop. The same holds for Jules for an unrelated reason: creating
a session is a normal API call a script *could* make, but deciding to
delegate a given app, reading back its result, and relaying feedback is
still judgment the automated loop's tool grants deliberately don't include
(see "Budget enforcement" — the worker's tool grant is container-use only).

This section applies whenever you're working inside a `bountybench-dagger-*/`
directory at the repo root. Each such directory is a standalone Dagger module
(own `dagger.json`, `go.mod`) that bootstraps one application from the
[bountybench/bountytasks](https://github.com/bountybench/bountytasks) corpus:
builds it, reproduces the topology from the task's own `docker-compose.yml`,
and replays the task's own exploit against it as an end-to-end proof the
target actually builds, runs, and is exploitable as bountybench expects.

Existing modules (as of this writing): `bountybench-dagger` (gunicorn,
bounty_0 — note the missing app suffix is a historical naming exception, not
the convention), `bountybench-dagger-django` (bounty_0), `bountybench-dagger-fastapi`
(bounty_0), `bountybench-dagger-mlflow` (in progress). New modules should
follow `bountybench-dagger-<app>` — the bare `bountybench-dagger` name is not
to be reused for a second app.

## Module shape

Every module's `main.go` follows the same skeleton (see `bountybench-dagger/main.go`
for the canonical example, gunicorn bounty_0):

- `Source() *dagger.Directory` — shallow-clones `bountytasks`, runs
  `git submodule update --init --depth 1 <app>/codebase` for that app's
  codebase submodule, returns the `<app>/` directory (the build context the
  task's own Dockerfiles expect).
- One unexported helper per service in the task's `docker-compose.yml`
  (e.g. `internalApp`, `relay`) — each does `src.DockerBuild(...)` against
  that service's Dockerfile under `bounties/bounty_N/setup_files/`.
- `Serve() *dagger.Service` — wires the per-service containers together
  exactly as the task's compose file does (`WithServiceBinding`, matching
  env vars), returns the externally-reachable service. This is the module's
  "run it like the real thing" mode (`dagger call serve up`).
- `Bootstrap(ctx) (string, error)` — the actual proof. Boots the same
  services (single container or wired services, whichever is simpler for
  this task), confirms a baseline (e.g. "the vulnerable path is blocked/behaves
  normally without the exploit"), replays the exact payload/steps from
  `bounties/bounty_N/exploit_files/exploit.sh`, then checks the effect the
  same way `bounties/bounty_N/verify_files/verify.sh` does. Returns the
  transcript of that pipeline as its result string.

Each bounty directory also carries `bounty_metadata.json` (CVE/CWE, the
`vulnerable_commit`, `bounty_setup_hosts`, the patch file mapping) — read it
before writing `Bootstrap`; it usually names the exact vulnerable function and
which commit to pin the codebase submodule to.

## Process for bootstrapping a new app

1. Pick the next app: list top-level dirs in `bountybench/bountytasks`
   (excluding non-app files like `README.md`, `*.py`, `*_schema.json`) and
   diff against existing `bountybench-dagger-*` directories in this repo.
   Prefer an app with a single bounty (`bounties/bounty_0` only) unless
   told otherwise — multi-bounty apps (mlflow has 4, gradio has 3, etc.)
   are more turns for the same "one more example" value.
2. `dagger init --sdk=go bountybench-dagger-<app>` (matching the existing
   modules' Go SDK choice), scaffold `main.go` per the shape above. Set the
   new module's `dagger.json` `engineVersion` to the same pinned version
   every other module uses (`v0.21.8` as of this writing — check an
   existing module's `dagger.json` if unsure, and see step 7's
   `devenv-agent` note below for where that pin actually comes from and
   why it matters).
3. Implement `Source()`, then inspect that bounty's `setup_files/` and
   `bounty_metadata.json` to identify the services and how they're wired.
4. Implement the per-service builders and `Serve()` first — get the app
   booting and reachable before touching the exploit.
5. Read `exploit_files/exploit.sh` and `verify_files/verify.sh` verbatim;
   implement `Bootstrap()` as a direct translation of those two scripts
   (see `smuggledAdminRequest` in `bountybench-dagger/main.go` for the
   pattern of lifting a payload out of `exploit.sh` as a Go constant).
6. Run `dagger call bootstrap` and `dagger call serve up` (+ a live
   curl/tunnel check) — both must pass before the module counts as done.
7. All of the above happens inside a **container-use environment**
   (`environment_create`/`environment_open`, then `environment_run_cmd` /
   `environment_file_*` for everything — never a manual `git commit` or
   `git push`). Commit history and the branch itself come from ordinary
   container-use use, not a separate git step. Do not push to
   `bountybench-dagger-modules` directly — see "Tracking and merging"
   below for how work actually lands there.
   - Create the environment with `base_image: ghcr.io/null-hype/devenv-agent:<tag>`
     (the image `.dagger/internal/devenv-base` publishes — see its own
     `CLAUDE.md`) rather than a bare base image plus ad hoc
     `setup_commands`. It already bundles `container-use`, its
     docker/git/dagger-cli prerequisites (dagger CLI pinned to
     `daggerCliVersion` in `devenv-base/main.go` — keep this in sync with
     every module's `engineVersion`), `pass-cli`, `tailscale`, and Claude
     Code. Notably it does **not** need a Go toolchain baked in: `dagger
     call` builds a module's Go-SDK code remotely via the engine itself,
     not the calling shell, so `base_image: golang:...` was never actually
     required for this work. Use the latest tag published by
     `devenv-base-publish.yml` (`sha-<commit>` off `main`) that postdates
     the Dagger CLI version pin (PR anthropic/agent-plugins#47, or its
     successor if that number is stale by the time you read this) —
     confirmed live: an environment that instead curled `dagger`'s
     install script unpinned inside its own `setup_commands` reintroduced
     the exact version-mismatch bug (see `dagger-preflight.ts`'s comment)
     one layer down, where the host-level preflight guard can't see it.
8. Name the environment for the app (e.g. `bountybench-dagger-<app>`) so
   it's identifiable later without having to open it — set this via
   whatever container-use exposes for a title/description on create.

## Budget enforcement

The worker and supervisor passes described below do not run as an
interactively-prompted subagent with a budget written into its instructions
— that's soft enforcement, and a model that ignores prompt text can still
overrun it. Instead both run via
`.dagger/internal/devenv-base/bountybench-loop/` (`npm run worker` /
`npm run supervisor`), a small script that calls the Claude Agent SDK's
`query()` directly with `maxTurns` and `allowedTools` set as real options —
the SDK itself stops the run once the cap is hit, and the tool grant (only
`mcp__container-use__*` for the worker; only `Bash`+`Read`, no `Write`/`Edit`,
for the supervisor) is what actually prevents the worker from touching git
directly or the supervisor from patching someone else's environment, not a
sentence asking it not to. See that package's `prompts/worker.md` and
`prompts/supervisor.md` for the exact task text each run gets — those files
are the literal `prompt` passed to `query()`, not documentation of it.

The `maxTurns` defaults are grounded in a real data point, not a guess: a
restic-backed `~/.claude` transcript showed gunicorn + django (two completed
modules) plus discussion overhead cost ~161 turns / ~83K output tokens
combined in one session — roughly 80 turns/app as a rough ceiling for a
clean run. But the goal of this loop is completion, not speed: cutting a
run off at a tight turn cap just leaves a partial environment for a later
worker run to redo the same ground on, which costs more turns overall than
letting the original run keep going. So `worker.ts` defaults `maxTurns` to
300 and `supervisor.ts` to 200 (its per-pass cost scales with the pending
backlog, less predictable) — well above the ~80/app baseline, functioning
as a runaway-loop backstop rather than a budget lever. Override via
`BOUNTYBENCH_WORKER_MAX_TURNS` / `BOUNTYBENCH_SUPERVISOR_MAX_TURNS` if a
few real runs show these are still too tight or needlessly loose.

Both scripts also set `settings.autoCompactWindow` to 200,000 tokens
(`BOUNTYBENCH_AUTO_COMPACT_WINDOW`) — ~20% of Sonnet 5's 1M-token context
window — so the SDK compacts well before the real limit instead of risking
a run dying mid-task from context exhaustion. Combined with the generous
`maxTurns` above, a run is expected to compact multiple times over its
course; that's the intended trade (more wall-clock time and compactions,
lower risk of an unattended run failing outright).

### Model tiering

Both scripts also set `Options.model` — low-effort by design, reserving
stronger models for the calls that actually need judgment:

- `worker.ts` runs on **Haiku**. The module skeleton it's following is
  fully scripted in this file's "Module shape"/"Process for bootstrapping a
  new app" sections above — fixed steps, fixed shape per
  `bountybench-dagger/main.go` — so this is mechanical work, not a call
  that needs a stronger model.
- `supervisor.ts` runs on **Sonnet** as its main model — the integration
  and correctness checks below require judgment a fixed script can't fully
  capture (is a GitButler conflict a real conflict, did `dagger call
  bootstrap` fail for a real reason).
- The supervisor also declares an `advisor` subagent (`agents.advisor` in
  `run-agent.ts`/`supervisor.ts`) on **Opus**, invoked only when the
  merge/no-merge call is genuinely ambiguous (see `prompts/supervisor.md`)
  — an on-demand second opinion, not a model swap for every pass.

## Tracking and merging (container-use + GitButler)

Work happens in per-app container-use environments, not directly on
`bountybench-dagger-modules`. That means the usual "check the directory
listing + `git log`" trick no longer shows in-progress work — an
environment's branch is invisible until someone looks at it.

- Before starting, run `container-use list` to see existing environments
  (title, created/updated) alongside the usual check of which
  `bountybench-dagger-*` directories already exist in the main tree and
  what's already merged into `bountybench-dagger-modules`. If an
  environment for an app looks partial and recent, prefer
  `environment_open`-ing it and finishing that app over starting a new one.
- **Merging is a separate, supervised pass — not something the per-app
  agent does.** It's the `bountybench-loop` supervisor run (see "Budget
  enforcement" above), on its own hourly cadence (staggered after the
  worker's firing, e.g. +15min), not on demand, so pending environments
  don't sit unreviewed for the whole run window. It can be fully automated
  *as long as its accept criterion is real* (see below) — it does not need
  to be a human, but it must not be a rubber stamp, and its tool grant
  (`Bash`+`Read` only, no `Write`/`Edit`) enforces "verify and integrate,
  don't fix" structurally rather than by asking nicely.
- Per pending environment, the supervisor pass:
  1. `container-use log <env>` + `container-use diff <env>` to see what
     happened and what changed.
  2. `container-use checkout <env>` to pull the branch locally, then use
     GitButler (`but`) to apply it as a virtual branch and check it applies
     cleanly against `bountybench-dagger-modules` and any other pending
     environment already applied this pass — this is the *integration*
     check (no silent clobbering between two apps' agents touching
     something shared). `but` ships its own agent-integration steering docs
     (`but agent setup --print`, `but skill install`) — consult those for
     exact invocations rather than guessing flags.
  3. **Independently re-run `dagger call bootstrap`** inside the checked-out
     worktree — fresh, not by reading the environment's own log or trusting
     the builder-agent's self-reported "done." This is the *correctness*
     check: did the bounty's own exploit/verify condition actually
     reproduce. A clean GitButler apply does not imply this; a builder's
     self-report does not either — both checks are required, and neither
     substitutes for the other.
  4. Only merge and push if both checks pass. If either fails, leave the
     environment as-is (don't delete it) and record why — a future run may
     `environment_open` it and fix it forward.
- This is also why environments need a durability story of their own —
  see "Backing up environment state" below.

## Delegated-agent lanes

There are two more parallel worker lanes alongside the container-use one
above, both owned exclusively by the **top-level interactive session** (see
"Roles") and both structurally the same shape: an external agent with no
Dagger engine writes the module's Go code and opens a PR; it never runs
`dagger call bootstrap` itself; the supervisor pass is the first thing that
actually executes the module, via the shared `pending-agent-prs.json` file
handoff (Lane 2 in `prompts/supervisor.md`). What differs between them is
just how the top-level session creates and replies to a delegation.

### Codex (via Linear)

The top-level interactive session files a Linear issue delegated to the
Codex agent (team "Citizen6.Librarian6.Refrain4") asking it to bootstrap one
app, instead of doing the work itself in a container-use environment. This
is a manual action the top-level session takes (when asked, or as part of
its own periodic check-in), not an automated cron script — see "Roles" for
why that's load-bearing, not just current convenience.

This lane exists because Codex Cloud's sandbox has no Docker/container
runtime and can't run a Dagger engine (confirmed via Linear document "Dagger
in codex" on CIT-20) — piping a remote engine to it would mean exposing an
unauthenticated, unencrypted (`_EXPERIMENTAL_DAGGER_RUNNER_HOST`'s own docs
say so) build engine over the network, which is not worth the risk for what
this buys. Instead Codex's scope is narrower than the container-use lane's:

- Codex writes the module's Go code and self-checks only with `go build`/
  `go vet` — it never runs `dagger call bootstrap` or `dagger call serve up`
  itself, and must not try to install Docker/a Dagger engine to do so. The
  delegating issue's description must say this explicitly (no engine
  available, don't attempt to install one) and ask Codex to reply on the
  thread with a PR link when done, scoped to a single new
  `bountybench-dagger-<app>/` directory.
- Linear delegate-agent threads have a specific reply mechanic: replying
  requires `parentId` set to the thread comment titled "This thread is for
  an agent session with Codex," not a bare `issueId` — a top-level comment
  creates an unrelated new thread Codex never sees. Confirmed live: this
  exact mistake happened once already in this project (see CIT-20's comment
  history) before being caught.
- If Codex's PR doesn't build/pass, the top-level session doesn't have to
  wait for its own local check or a Linear round-trip to give Codex
  something to act on: `.github/workflows/bountybench-dagger-check.yml`
  (`workflow_dispatch` only, never automatic) runs a real `dagger call
  bootstrap` in CI — GitHub-hosted runners have Docker, so this actually
  works, unlike Codex's own sandbox — and posts the result as a commit
  status on the PR's head SHA, which Codex can see directly on its own PR.
  Trigger it with `gh workflow run bountybench-dagger-check.yml --ref
  <codex-branch> -f module=<app>` right after noticing a new Codex PR. This
  is a fast feedback loop for Codex to iterate against, not a replacement
  for the supervisor's own independent re-run at merge time below — that
  stays the actual merge gate regardless of what CI reported.
- When Codex replies with a PR, the top-level session fetches that branch
  locally and appends an entry (`"agent": "codex"`, see schema below) to
  `pending-agent-prs.json`.
- The top-level session reads the supervisor's report afterward and is the
  one who actually replies to Codex on the Linear thread (pass: nothing
  further needed; fail: relay the verbatim `dagger call bootstrap`/GitButler
  output so Codex has something concrete to fix).

### Jules (via `jules.googleapis.com`)

The top-level interactive session can also delegate an app to
[Jules](https://jules.google), Google's agent, using the official
`@google/jules-sdk` TypeScript SDK. This lane exists for the same reason as
Codex's: Jules sessions run in a sandbox with no Docker/container runtime,
so it self-checks with `go build`/`go vet` only and never runs `dagger call`
itself — the delegating prompt must say this explicitly, same as Codex's
issue description.

- Auth: `JULES_API_KEY` (`pass://infra/jules.googleapis.com/JULES_API_KEY`
  in the infra vault) — resolve it via `pass-cli run --env-file <file> --
  <command>`, never `source` a `pass://` reference directly (that passes the
  literal string, not the secret — this bit the Codex-lane tooling once
  already; see the `pass-cli` skill).
- A source repo must be connected to Jules through the **jules.google web
  UI** first — the API is read-only for sources
  (`GET /v1alpha/sources`), there is no way to register a repo via API. This
  is a one-time setup step, not something the top-level session can do
  itself; confirm the target repo is already connected before delegating.
- Jules has this workspace's Linear MCP tools wired up on its own side, the
  same way Codex reads its delegating issue — so the *preferred* path mirrors
  the Codex lane exactly: file (or reuse) a Linear issue with the app's full
  spec first, the same way you would for a Codex delegation, then delegate
  to Jules with a short prompt that just points at it (`npm run
  jules-delegate -- <app> --repo <owner>/<repo> --issue CIT-20`, which
  produces the literal prompt "work on CIT-20" plus the no-engine/scope
  reminder — see `jules-delegate.ts`'s `issuePrompt()`). Jules pulls the
  actual detail itself via its own MCP tool call; you are not inlining the
  spec into the prompt string in this path.
  - `--prompt-file <path>` / the script's built-in `defaultPrompt()` (used
    when neither `--issue` nor `--prompt-file` is given) remain as a fallback
    for delegating without a Linear issue on hand — these do inline the
    module-shape spec directly into the prompt, since there's no MCP-backed
    issue for Jules to read in that case.
- Delegate with `jules.run({ prompt, source: { github: "<owner>/<repo>",
  baseBranch: "main" }, title: "bountybench-dagger-<app>" })` — `run()`
  defaults `requireApproval: false` and `autoPr: true`, so the session
  proceeds unattended and opens a PR on completion without anyone needing to
  call `session.approve()`. Awaiting `jules.run(...)` itself only waits for
  session creation (fast); do **not** await the returned `AutomatedSession`
  as a promise (i.e. don't call `.result()`) — that blocks until the session
  finishes, which defeats the fire-and-forget delegate-then-check-back-later
  pattern this lane is meant to follow, matching how Codex delegations work.
- Check back on a delegated session with `jules.session(sessionId).info()`
  (state, `outputs[].pullRequest`) or `.stream()` for activity — there is no
  CI feedback loop analogous to `bountybench-dagger-check.yml` for this
  lane; if a Jules PR doesn't build, feed it back with
  `jules.session(sessionId).send(message)`, not a GitHub commit status.
- When Jules opens a PR, the top-level session fetches that branch locally
  and appends an entry (`"agent": "jules"`, see schema below) to
  `pending-agent-prs.json`.
- The top-level session reads the supervisor's report afterward and relays
  pass/fail back to Jules via `session.send(...)` (fail: the verbatim
  `dagger call bootstrap`/GitButler output, same as the Codex reply).

### Shared handoff to the supervisor

Regardless of which of the two above produced the PR, the top-level session
appends one JSON object to
`.dagger/internal/devenv-base/bountybench-loop/pending-agent-prs.json`
(gitignored, host-local — see that file's consumer in `prompts/
supervisor.md`'s "Lane 2" for the exact schema, which is
`{"agent": "codex"|"jules", "app", "branch", "pr_url", ...}` plus whichever
of `linear_issue` / `jules_session_id` applies). This is the *only* handoff
to the automated supervisor pass; the supervisor has no Linear or Jules
access and never talks to either agent.

The supervisor pass then treats every entry exactly like a container-use
environment: GitButler integration check, then an **independent, from-
scratch `dagger call bootstrap` re-run** — for either lane this is the
*first* real execution of the module, not a recheck, since neither agent had
a way to run it itself. It merges if that passes, or records the exact
failure in its report if not — and either way removes the entry from
`pending-agent-prs.json` once handled. Before delegating a new app to
either agent, the top-level session checks the same backlogs the
container-use worker does (merged modules, in-progress container-use
environments) plus already-open Codex delegations on Linear and open Jules
sessions, so no two lanes duplicate work on the same app.

## Backing up environment state

container-use stores real git state on the host, not inside the
short-lived container: a bare repo under `~/.config/container-use/repos/`
and per-environment worktrees under `~/.config/container-use/worktrees/`.
Nothing here is pushed anywhere until the supervisor pass above merges it,
so it needs the same restic coverage `~/.claude` already gets, under its
own tag (`container-use-state`, alongside `claude-session-state`) — see
`gce_common_restic_push_container_use_state` in
`.dagger/internal/devenv-base/.devcontainer/lib/gce-common.sh`.

This is wired as a real backup step, not a manual habit — two trigger
points, both required:

1. **`hk` `pre-push` hook** on this repo: the existing
   `claude-session-backup` step in `hk.pkl`'s `pre-push` hooks
   (`.dagger/internal/devenv-base/hk/claude-session-backup.sh`) — originally
   `~/.claude`-only — now also runs
   `gce_common_restic_push_container_use_state` in the same best-effort,
   non-push-blocking pass. So every time the supervisor pass actually
   pushes to `bountybench-dagger-modules`, both backups run as part of
   that push.
2. **The supervisor pass itself, unconditionally, every firing** — not
   only when it merges something. An hour where nothing passes both gates
   still leaves in-progress container-use work that needs covering; don't
   let backup coverage depend on there being a push that hour. (This half
   is still a `prompts/supervisor.md` instruction, not a script — see step
   6 there.)
