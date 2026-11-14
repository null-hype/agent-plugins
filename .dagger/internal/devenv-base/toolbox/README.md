# Toolbox (CIT-430)

An MCP server on Render that the Linear Agent uses to manage DevPod
workspaces on one GCE host VM. Instead of keeping a VM alive, the host runs
only when asked: start it, start the Linear agent's workspace, delegate
issues, stop it.

```
Linear Agent ──MCP, Bearer TOOLBOX_TOKEN──▶ toolbox (Render)
                                              │ Compute API: start, stop, status, host keys
                                              │ SSH as toolbox, host key checked against the VM's guest attributes
                                              ▼
                                   toolbox-host (GCE, Debian 12)
                                   Docker + DevPod docker provider
                                   ├─ linear-agent   (Linear agent + Cloudflare connector)
                                   ├─ cit-430
                                   └─ ...
```

DevPod runs on the host, so all workspace state lives on the VM's disk and
the Render service keeps none. Each tool call pipes `host.sh` over SSH.

## Tools

| Tool | Does |
| --- | --- |
| `host_status` | VM status and IP; `ready` once the boot script has finished; the tailnet node, joining it first if needed; `lifecycle`, the idle clock and lease (see [Lifecycle](#lifecycle)) |
| `host_wake` | One step towards taking work per call: start the VM, wait for it to boot, start the Linear agent, wait for its webhook check. Delegate only once `ready` is true |
| `host_start` | Start the VM |
| `host_stop` | Stop every running workspace, then the VM; refuses while any job (workspace, ship, review) runs or the Linear agent is working an issue |
| `workspace_list` | Workspaces with their state |
| `workspace_up` | Create (from agent-plugins at `ref`, default `main`) or start a workspace; with `shadow` true, make it a [claude-shadow](#claude-shadow) |
| `agent_start` | `workspace_up` for `linear-agent`, then the keepalive's bootstrap scripts |
| `workspace_status` | State, latest job's exit code and log tail; for a shadow, also its `shadow` object |
| `shadow_list` | The agents and panes of a shadow's Herdr session (read-only) |
| `shadow_read` | The last `lines` (1 to 500, default 80) rows of a shadow pane's terminal (read-only) |
| `shadow_prompt` | Send a prompt to a shadow and wait up to `timeout_ms` (5000 to 110000, default 90000) for it to finish |
| `workspace_stop` / `workspace_delete` | Stop or delete a workspace |
| `codex_review` | Codex reviews a PR (optional `model`) against `AGENTS.md` with the host's login and creates a container-use environment on the host and a CIT Triage issue for each finding, pushing the environment's branch under the issue's branch name |
| `agent_ship` | Ship the Linear agent's container-use environment (its sandbox cannot push): Codex on the host runs `container-use merge` for it in a worktree of the `linear-agent` workspace, then `git push` to the issue's Linear branch (`branch`), without force. Returns at once |
| `agent_ship_status` | The ship job's exit code, the environment and branch it was started for (`request`), the commit now on the branch once GitHub confirms the environment is on it, Codex's last message and log tail |
| `codex_review_status` | The review job's exit code, one line per finding (environment id, Linear issue, branch, title) and log tail |
| `codespace_status` | Whether a GitHub codespace is running, starting, stopping, stopped or rebuilding, and its repository and branch |
| `codespace_start` / `codespace_stop` | Start or stop a GitHub codespace by name, through the GitHub API (CIT-436); says so and does nothing if it already is |
| `codespace_rebuild` | Rebuild a running codespace's container from the dev container config on its branch, with the image's `gh` (GitHub's REST API has no rebuild). Only `/workspaces` is kept |

The Linear Agent gives up on a tool call after 3 minutes (measured in the
spike), so `workspace_up` and `agent_start` start a job on the host and
return. Poll `workspace_status` until `job_exit` is set. Every call is
cut off at 150 seconds.

Only one workspace runs the Linear agent: a second Cloudflare connector on
the same tunnel would take half the webhooks. `workspace_up` refuses that
name.

## Claude-shadow

A claude-shadow is a persistent interactive Claude Code session in a
workspace, kept by [Herdr](https://herdr.dev/llms.txt): a Herdr server whose
session is named after the workspace, with Claude running as
`claude [--resume <session>] --remote-control <workspace>` in its first pane
(`w1:p1`), with `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` unset,
because Remote Control needs the standard subscription login.

`workspace_up` with `shadow: true` (optionally `session_id`, the Claude session
UUID to resume, and `delta_thread`, a `https://delta.dev/join/thread_...` link)
does three things:

1. Creates the workspace from `.devcontainer/shadow/devcontainer.json`, the
   default config plus a docker volume `<workspace>-home` at `/root` (the
   image runs as root), so the Claude and Delta logins and conversations
   survive a rebuild. (A test keeps it equal to the default config apart from
   the mount.) A workspace that already exists keeps the config it was
   created with.
2. Runs `.devcontainer/start-shadow.sh` from the workspace's checkout. Safe to
   run again. It:
   - installs what is missing: a pinned, checksummed Herdr; Claude Code; the
     Delta CLI (`delta-install.sh --non-interactive`, needs python3); and the
     Delta plugin (`claude plugin marketplace add zed-industries/delta-claude`,
     `claude plugin install delta@zed-industries`). A Claude that is already
     running only sees a new plugin after `/reload-plugins`;
   - writes `theme` and `tui` to `~/.claude/settings.json` if unset, the
     documented settings that stop the theme and "try the fullscreen
     renderer?" prompts (`tui: default`, the classic renderer, which also
     reads better through `shadow_read`). Claude's login screen and its
     folder-trust dialog have no documented setting; a person answers them
     once;
   - starts the Herdr server and Claude only if they are not running. A Claude
     that Herdr resumed by itself after a server restart, without
     `--remote-control`, is stopped (`/exit`, then Ctrl+C twice) and started
     again properly; a pane that is not a plain shell is never typed into;
   - remembers Claude's session UUID (from Herdr) in
     `~/.shadow/<workspace>.session-id`, so a restart or rebuild resumes it;
   - never logs in, to Claude or to Delta. It records `needs-login` or
     `needs-delta-login` (attach and run `delta auth login`) in
     `~/.shadow/<workspace>.json`;
   - with `delta_thread`, once both are signed in, sends `/delta join <link>`
     to Claude, once per link (joined links are in the state file). Joining may
     ask to trust the thread's folder, which only a person can answer.
3. Marks the workspace, so `workspace_status` adds a `shadow` object while it
   runs: `herdr_session`, `claude_pane`, `logged_in` and `delta_signed_in`
   (`true`, `false` or `"unknown"`), `state` (live: `running`, `needs-login`,
   `needs-delta-login`, `no-claude`, `no-herdr-session`), `start` (what
   `start-shadow.sh` last recorded, which goes stale after a login) and
   `attach`, the `gcloud compute ssh` command a person runs on their own
   machine to open the Herdr TUI.

`shadow_list`, `shadow_read` and `shadow_prompt` run Herdr in the workspace
through `devpod ssh` and need the workspace running. They never start it.
`target` is a Herdr pane id or agent name (default `w1:p1`). A prompt that
times out may still have been delivered: read the pane before retrying.

The keepalive does not start shadows.

## Secrets

| Render env var | From |
| --- | --- |
| `TOOLBOX_TOKEN` | Generated by Render; the Linear connector sends it as `Authorization: Bearer …` |
| `GCP_SERVICE_ACCOUNT_KEY` | `toolbox-render` service account, admin of the host instance only |
| `TOOLBOX_SSH_KEY` | Private key whose public half is the VM's `toolbox` ssh-keys metadata |
| `GITHUB_TOKEN` | `pass://infra/github.com/GITHUB_TOKEN`, for cloning the private repo, and with Codespaces lifecycle admin for the codespace tools |
| `PROTON_PASS_PERSONAL_ACCESS_TOKEN` | Logs in the host's pass-cli when it has no session: gives Codex's curl the Linear key in `codex_review`, and resolves `agent_ship`'s push token |
| `LINEAR_AGENT_PASS_TOKEN` | The agent workspace's own Pass token, from `tidelands.dev/linear-agent-host`: the Pass agent `setup-agent-pass.sh` makes, which can view only the four items the workspace's start scripts read. `agent_start` sends it to the workspace's `tailscale-up.sh`, and refuses without it |
| `TS_AUTHKEY` | `pass://infra/tailscale/TS_AUTHKEY`, joins the host itself to the tailnet (optional) |
| `LINEAR_CHECK_WEBHOOK_SECRET` | The signing secret of the Linear data-change webhook for [check reruns](#check-reruns) (optional) |
| `LINEAR_API_KEY` | `pass://api.linear.app/Citizen6.Librarian6.Refrain4/LINEAR_API_KEY`: the rerun controller's comments and state changes. Only the toolbox holds it; the host and the checks never see it (optional; reruns stay off without it) |

## Check reruns

An Infrastructure issue whose description names a check of
`null-hype/worlds` ("This issue and `null-hype/worlds` … `dagger check
<name>`") is rerun when it moves to Todo. Linear signs a data-change webhook to `/linear/webhook`; the toolbox
moves the issue to In Review, wakes the host, and runs `host.sh check`, a job
that clones the repository's main and runs `dagger check <name>` with the
repository's `.env` and a Dagger Cloud token, both resolved by the host's
pass-cli. A check that takes a `run` gets `linear-<issue>`, so one issue's
reruns resume one session. The toolbox polls `check-status` and comments the
result with its trace: a green check moves the issue to Done; a red one, or a
job that broke before the check gave a verdict, leaves it In Review with the
end of the log. The check's exit code is its verdict, and the controller
reads nothing else of it. Move the issue to Todo again to rerun.

With an item-scoped Proton Pass runtime token, named vault references may not
resolve. Put the check's variables with their granted `pass://<share-id>/<item-id>/<field>`
references in the host's `~/.toolbox/check.env` (mode 0600). This optional file
overrides the cloned repository's `.env` and the default Dagger trace reference;
it contains references, not secret values. Update it when replacing item grants.
The check launcher removes unrelated host-action secret references before Pass
resolves the check's environment, so checks need no GitHub or Linear grant.

## Agent delegations (CIT-576)

Delegating an issue to the Claude agent makes Linear send an
`AgentSessionEvent` (`created`; `prompted` for later messages) to the OAuth
app's webhook URL, which must answer within 5 seconds. Linear retries a failed
delivery only after 1 minute, 1 hour and 6 hours, so a stopped VM would miss
the work. With the app's webhook URL set to `https://<toolbox>/linear/agent-webhook`,
the toolbox verifies the event, answers 200, keeps it, runs the same wake as
`host_wake` until the agent's webhook answers, and posts the event to the
agent's own webhook (restamped and re-signed, since the agent rejects bodies
older than a minute). The agent is unchanged.

- Sessions: a `created` event is a delegation or a mention (Linear does not
  say which in the action), so both wake the host. Assigning an issue to a
  person sends no session event and wakes nothing. On arrival the toolbox reads
  the issue's delegate from Linear. Delegated to the agent: re-read at delivery
  and dropped if withdrawn, for `prompted` events too. Delegated to someone
  else (a mention): not subject to that check. Linear unreachable: unknown, not
  a mention; it is re-read at delivery (retried while unreadable), delivered if
  the agent holds the issue then, and otherwise not started, with a comment on
  the issue, because a mention and a withdrawn delegation cannot be told apart.
- Dropped, never started: events for another app user, finished sessions, bad
  signatures, bodies older than a minute, a repeated delivery or session, and a
  session older (by Linear's `agentSession.createdAt`, not arrival) than another
  of the same issue.
- `Issue` events (an edited description of a delegated issue) are passed on to
  the agent when the host is already running, and dropped when it is stopped:
  the agent follows an edit only for a session it holds in memory, which a
  stopped host has not.
- Delivery is at-least-once, the run at-most-once. The agent builds the
  event's prompt and records its claim (`LINEAR_AGENT_STATE_DIR`, default
  `~/.linear-agent/claims`) before it answers; a failure in either is a 500, so
  Linear or the relay retries, and an unclaimed event is not mistaken for a
  repeat. Only the Claude run itself is detached. A repeat of a claimed event
  is ignored, so a resend after a lost answer or a toolbox crash starts no
  second run. If the agent dies mid-run the event is not run again; prompt the
  session again.
- Failure: the issue gets a comment (starting; or why it could not be taken,
  with "delegate again to retry").
- Durability: every accepted event is written to `LINEAR_AGENT_RELAY_DIR`
  before the 200; if it cannot be written the answer is 500 and Linear
  retries. Records stay as `.json` (undelivered, resumed on boot), `.done` or
  `.failed` (pruned after a week), so a redelivery after a restart is still a
  duplicate. The route is not registered at all without a writable directory.

Off until all are set: `LINEAR_AGENT_WEBHOOK_SECRET` (the app's signing
secret), `LINEAR_API_KEY`, `LINEAR_AGENT_APP_USER_ID`,
`LINEAR_AGENT_WEBHOOK_URL` (the agent's `/webhooks/linear`) and
`LINEAR_AGENT_RELAY_DIR` (a persistent disk).

### More than one agent

Each Linear agent is its own OAuth app with its own app user and signing
secret, so each gets its own route and relay; they share `LINEAR_API_KEY`,
`LINEAR_AGENT_RELAY_DIR` and one wake, so delegations to two agents still
start the host once. The Claude agent keeps the settings above and
`/linear/agent-webhook`. Every name in `LINEAR_AGENTS` (comma-separated)
adds one on `/linear/agent-webhook/<name>`, off until all of its own
settings are set:

| Setting | Is |
| --- | --- |
| `LINEAR_AGENT_<NAME>_WEBHOOK_SECRET` | That app's signing secret; a route only accepts its own app's signature |
| `LINEAR_AGENT_<NAME>_APP_USER_ID` | That app's user, the delegate the relay checks for |
| `LINEAR_AGENT_<NAME>_WEBHOOK_URL` | That agent's `/webhooks/linear` on the host |
| `LINEAR_AGENT_<NAME>_LABEL` | How the relay's issue comments name it (optional, default "The <name> agent") |

Its events are kept in `<LINEAR_AGENT_RELAY_DIR>/<name>`.

The second agent today is `openrouter`: the same linear-agent server with
`AGENT_RUNTIME=openrouter` (an open-weight model on OpenRouter:
`OPENROUTER_MODEL` in `openrouter-agent.env`, a model that has completed a
real agent turn, since the cheapest with tool calling changes with the
catalog and may fail the agent's requests, CIT-587; the cheapest is used
only when it is unset; with the
same container-use tool surface and work contract as Claude), started by
`start-openrouter-agent.sh` on port 8081 from `openrouter-agent.env` in the
same `linear-agent` workspace. To turn it on:

1. Create its Linear OAuth app: callback
   `https://openrouter-agent.tidelands.dev/oauth/callback`, webhook
   `https://<toolbox>/linear/agent-webhook/openrouter`, with Agent session
   events and Issues.
2. Create `pass://tidelands.dev/openrouter-agent` with `CLIENT_ID`,
   `CLIENT_SECRET`, `SIGNING_SECRET`, `OPENROUTER_API_KEY` and an empty
   `DEVELOPER_TOKEN`, and declare it in `pkl/Vaults.pkl` (and the env file in
   `pkl/Vaults.test.pkl`).
3. Route `openrouter-agent.tidelands.dev` to `http://localhost:8081` in the
   Cloudflare tunnel's ingress, next to `agent.tidelands.dev`.
4. Publish the linear-agent image, wake the host, open
   `https://openrouter-agent.tidelands.dev/oauth/authorize` once and keep the
   token as `DEVELOPER_TOKEN`; the app user id is `viewer { id }` with it.
5. Set `LINEAR_AGENTS=openrouter` and its `LINEAR_AGENT_OPENROUTER_*`
   settings (`_LABEL` "The OpenRouter agent") on the toolbox.

`host_wake` reports ready on the Claude agent's live webhook check. A
delegation to the second agent waits on its own delivery instead: until its
webhook answers, delivery fails and is retried with the wake, and after the
relay's 30 minutes it is commented on the issue as not taken. Check it by
hand with `URL=https://openrouter-agent.tidelands.dev/webhooks/linear
ENV_FILE=.devcontainer/openrouter-agent.env` and
`check-linear-agent-webhook-live.sh`.

Only the newest session of an issue is delivered. An older one still waiting
for the host is dropped when a newer one arrives, and the issue gets a comment
naming the session that will not be taken.

### OpenRouter traces

OpenRouter's [Broadcast](https://openrouter.ai/docs/guides/features/broadcast/webhook)
can send a trace of every request to `/openrouter/traces`, as OTLP JSON. This
keeps for the OpenRouter agent what `~/.claude` keeps for the Claude agent:
what the model was sent and what it answered, for each session. The agent sets
each request's `session_id` to its Linear agent session and gives each turn its
own trace, named for the issue (`linear-agent/src/openrouter.ts`). The sink is
on the toolbox, not the host, because traces arrive after the turn.

- Store: each span goes to `<dir>/<session.id>.ndjson`, one OTLP payload per
  line. Spans without a session go to `_no-session.ndjson`. A session's file
  is removed 30 days after its last write.
- Read: `GET /openrouter/traces/<session>` with `TOOLBOX_TOKEN`.
- The traces contain issue text and tool output. They are kept only on the
  disk and nothing publishes them.

To turn it on:

1. Set `OPENROUTER_TRACE_TOKEN` (a random secret) on the toolbox. The
   directory is `OPENROUTER_TRACE_DIR`, or `traces/` under
   `LINEAR_AGENT_RELAY_DIR`.
2. In OpenRouter, go to Settings > Observability and enable Broadcast. Add a
   Webhook destination with URL `https://<toolbox>/openrouter/traces` and
   headers `{"Authorization": "Bearer <OPENROUTER_TRACE_TOKEN>"}`. Limit it to
   the agent's API key. Leave Privacy Mode off if the traces should include
   the prompts.

## Tailscale and Codex

The host is its own tailnet node, `toolbox-host`, with Tailscale SSH. The
first `host_status` on a ready host runs `tailscale up`; tailscaled keeps the
node across reboots. The `linear-agent` workspace joins separately, through
`tailscale-up.sh`, as it did on the old VM.

The boot script also installs pinned Codex and container-use CLIs, and pass-cli. Log in once from a tailnet
device; the login stays on the host's disk:

```sh
ssh toolbox@toolbox-host
codex login --device-auth
```

Secrets reach the host on SSH stdin and stay in the job's environment; git
reads the GitHub token through a credential helper. Without the four
required ones, the server offers only `ping`. With them, it refuses to start without
`TOOLBOX_TOKEN`.

`setup-host.sh` creates the VM and service account and writes these to
Render. Rerunning it replaces the SSH key.

## Shipping

`agent_ship` starts one job at a time (`ship` in `~/.toolbox/jobs`). It adds a
worktree to the `linear-agent` workspace at the issue's branch, or at
`origin/main` if the branch does not exist yet, so the push is a fast-forward.
Codex then runs two scripts, `~/.toolbox/ship/bin/ship-merge` and
`ship-push`, which run `container-use merge <env>` and `git push origin
HEAD:refs/heads/<branch>` in that worktree through `devpod ssh`. (The binary
is `container-use`, which `cu` aliases.) A worktree shares the checkout's git
config, so `container-use` finds the same fork repository through its
`container-use` remote. Codex runs with its own `CODEX_HOME`
(`~/.toolbox/ship`, sharing the host's login), a read-only sandbox, and
rules that allow those two scripts and nothing else. When Codex exits, the
job fetches the branch from GitHub and fails unless it contains the
environment's tip.

The push credential is not stored on the host. `agent_ship` writes
`~/.toolbox/ship/ship.env`, which holds only the reference
`SHIP_PUSH_PAT=pass://infra/github.com/GITHUB_TOKEN`, and `ship-push` and the
check at the end resolve it with `pass-cli run --env-file` (with
`PROTON_PASS_KEY_PROVIDER=fs`) under the host's own Proton Pass session. That
item should be a fine-grained token with contents write on the repository and
nothing else. The host needs a pass session; the `codex_review` job creates one
with the Proton Pass token Render holds, or log in once by hand:

```sh
ssh toolbox@toolbox-host
PROTON_PASS_KEY_PROVIDER=fs pass-cli login
```

`agent_ship` sends no secret from Render and refuses, before it starts a job,
if the host has no pass session. The Linear key is not on this path. The token
is not in Codex's environment or on any command line, and no file holds it:
`pass-cli run` puts it in the environment of `devpod ssh`, which forwards it
to the push, and to the check at the end, through `--send-env`.

What this does not guarantee:

- The two commands are scripts, not the commands themselves, because a rule
  matches a command plus anything appended to it, so an appended `--command`
  could replace the allowed one. Any other command Codex tries is not
  refused: it runs in the read-only sandbox without network. Read-only
  still reads, and the host's pass session belongs to the same Unix user as
  Codex, so such a command could read the session's files. It has no network,
  so it cannot ask Proton Pass for the token itself. Closing that takes a
  separate Unix user for the pass session and a sudoers entry for `ship-push`
  alone.
- The token is in the process environment inside the `linear-agent` container
  while the push runs, where the Linear agent also runs.
- That the sandbox keeps those other commands off the docker socket (the
  `toolbox` user is in the `docker` group, so a command that reaches it can run
  anything in the workspace container) depends on Codex's seccomp filter
  refusing `connect` on unix sockets. Check on the host:
  `codex sandbox -- python3 -c "import socket; socket.socket(socket.AF_UNIX).connect('/var/run/docker.sock')"`
  must fail.
- `~/.toolbox/ship/codex/auth.json` is a link to the host's login. If Codex
  replaces the file when it refreshes the token, the link is replaced by a
  copy; log in again on the host if `codex_review` stops working after a ship.

## Lifecycle

The host is on only while there is work (CIT-466). `host-lifecycle.sh`
runs on the host as `toolbox-lifecycle`, from a systemd timer every minute,
so no agent or LLM has to remember to stop it:

- **Wake before dispatch.** Call `host_wake` until `ready` is true, then
  delegate. Until then the work stays queued in Linear: nothing is
  delegated to an agent whose webhook is not live. `ready` comes from the
  live webhook check run on that call, not from an old start result; an
  agent whose webhook stopped answering is restarted.
- **Productive work** is a running toolbox job (workspace up, ship,
  review, whose last step is the restic backup), a Linear agent working an
  issue (the Claude agent's `claude-agent-sdk` process, or the `container-use
  stdio` MCP server either agent runs during a turn), or a `restic` or
  `codex` process.
  A poll, an SSH session or any other tool call is not, so it does not keep
  the host up.
- **Idle shutdown** after 15 minutes without productive work.
- **Lease.** The host gets 120 minutes from boot. A tick with work in
  progress at the deadline moves it 15 minutes later, never past a hard cap
  of 240 minutes, where the host stops even mid-job.
- **Before poweroff** each running workspace is stopped with `devpod stop`,
  which keeps its files; the disk keeps the jobs' logs and results. Listing
  and stopping the workspaces share one 5-minute budget, after which the
  host powers off whatever devpod is doing.
- **On the next boot** a job left without an exit code gets `130` and a
  `.interrupted` marker, stale pid files go, and workspace start results
  from the last boot are set aside so `host_wake` starts the agent afresh.
  `agent_ship` is idempotent, and `codex_review` skips a PR head it already
  reviewed successfully, so a retried job does not duplicate pushes or
  triage issues. A review cut off after Codex filed its findings resumes at
  the push, and one cut off during Codex's run asks Codex to reuse the
  issues it already filed for that head (`Reviewed commit:` in each).
  The boot step runs once per kernel boot id, and a tick that finds state
  from an earlier boot runs it first, so a host that has just started is
  never stopped by the last boot's clocks.
- **Backstop.** The instance has a GCE max run duration of 4h30m with a
  STOP action, so Compute Engine stops it even if the timer on the host
  died.

The limits are `LIFECYCLE_IDLE_MIN`, `LIFECYCLE_LEASE_MIN`,
`LIFECYCLE_EXTEND_MIN`, `LIFECYCLE_MAX_MIN` and `LIFECYCLE_STOP_BUDGET_S`.
The `toolbox-host lifecycle` workflow keeps the instance's `startup-script`
and `toolbox-lifecycle` metadata and its max run duration in step with
`main`; the boot script installs the lifecycle script, so a change takes
effect at the host's next boot. A push to another branch only plans.

## Test

```sh
docker build -t toolbox .
```

The build runs the tests, including `TestHostScript`, which runs `host.sh`
against a fake `devpod` (it skips where `jq` is missing).

### Static claim pages (CIT-563)

The report layout is shared with `tutorial-app`'s **Tidelands / Claim report**
Storybook stories. Its status badge also serves the integration-check stories;
its numbered text view also serves the captured evidence inspector. The root
Astro page uses the same branding and the existing interactive integration
check. Reports remain static HTML with embedded CSS and need no JavaScript.

After changing the report components or their styles, run `npm run claim:export`
in `tutorial-app` and commit the generated `claim-page.html` here. Run
`npm run claim:check` to detect a stale export; the toolbox workflow checks this
as well as building and testing the Go image. Node is a development dependency
for the export, not a dependency of the deployed publisher.

After a check finishes, the existing rerun controller reads the issue's current
title, description and labels from Linear and uploads one self-contained HTML
object to R2. Both green and red reruns replace that object. Only Dagger's exit
code selects the verdict and state; metadata or publishing failures are logged
and reported in the comment without changing that verdict. Broken host jobs do
not publish a completed result.

Configure these on the toolbox, alongside the existing webhook configuration:

| Variable | Value |
| --- | --- |
| `R2_ENDPOINT` | HTTPS S3 origin, e.g. `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | Bucket behind the claim domain |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 S3 credentials with object write permission for that bucket |
| `CLAIM_URL_SECRET` | At least 32 random bytes, generated once (e.g. `openssl rand -hex 32`) and retained across deployments |
| `CLAIM_BASE_URL` | HTTPS custom domain origin; defaults to `https://check.tidelands.dev` |

Missing or invalid configuration disables publishing and logs the reason. R2
credentials stay in the toolbox; the host and Dagger checks never receive them.

An exact `public` label opts into `/<issue-title-in-kebab-case>`, for example
`Registered Delivery` publishes at `/registered-delivery`. Lowercase letters and
numbers are retained; runs of spaces or punctuation become one hyphen, with no
leading or trailing hyphen. A title without letters or numbers cannot publish.
Public titles must have distinct slugs. Renaming a public issue changes its URL
on the next publish; old objects are not deleted automatically. Reruns with the
same title overwrite the same URL, regardless of verdict. The run key remains
`linear-<issue>`; it is independent of the public URL.
Other issues use `/r/<HMAC-SHA256-token>` derived from the immutable Linear issue
UUID and `CLAIM_URL_SECRET`. Titles, deliveries and R2 key rotations do not change
private URLs. Retain the URL secret: rotating it changes private URLs.
These are unlisted bearer URLs, without authentication. Visibility label changes
select a different route; existing objects are not deleted automatically, so
remove previously public objects explicitly before treating a claim as private.

The bucket's custom domain must serve extensionless object keys directly (keys
are `registered-delivery` or `r/<token>`, with HTML Content-Type). Disable any cache rule that
forces caching these paths; uploads have `Cache-Control: no-store` so subsequent
reruns are visible without cache purges. If the domain previously cached these
keys, purge them once when enabling publishing.

Add the rule in `claim-page-response-headers.json` ([Cloudflare API instructions](https://developers.cloudflare.com/rules/transform/response-header-modification/create-api/)) to the domain's existing
Cloudflare zone ruleset in phase `http_response_headers_transform`. Merge this
rule into that ruleset; do not replace other rules. Adjust the hostname when
using another `CLAIM_BASE_URL`. It sets `X-Robots-Tag: noindex` on every `/r/*`
response, including missing objects, and adds browser cache/referrer headers.
This response rule does not control Cloudflare edge caching; respect the object's
origin Cache-Control or add a separate Cache Rule to bypass these paths. This is an edge rule,
not S3 custom metadata or an uploaded `_headers` file: those do not set arbitrary
HTTP headers on R2 custom domains. The publisher HEADs the exact private URL
before uploading and requires HTTP 200 or 404 with `X-Robots-Tag: noindex`.
Without that evidence it skips publishing and records the failure. The HTML also
has a noindex meta tag and a no-referrer policy.

The page includes the trace, snapshot identity and run key, and a snapshot
evidence link to the Dagger trace. The host collects a full snapshot ID only
from a `World:` provenance record explicitly tagged `run=linear-<issue>` in the
check log. Missing provenance is displayed as unavailable; it never supplies or
changes the verdict. There is no assumed public restic browser or repository
credential in the page. `#xeno-status` shows the Linear issue status captured after completion.
A green run attempts its Done transition before reading that status; a red
run retains the current Linear state. A failed transition is reported, and
the page still shows the actual returned state. `xeno` in `#claim-data`
projects that same `{id, name, type}` state, or null when unavailable.
The Dagger verdict still comes only from its exit code. Further xeno visuals
remain the integration point for CIT-562.

For a local proof with synthetic input, without starting the server or host:

```sh
go build -o /tmp/toolbox-claim .
/tmp/toolbox-claim render-claim < testdata/completed-claim.json > /tmp/claim.html
go test ./... -run 'Test(Claim|PrivateClaim|RenderClaim|RerunPublishing|CheckCollectsSnapshot)' -v
```

The tests run the actual publisher against a local HTTP fake of R2 and check
signed uploads, stable private/public URLs, green-to-red overwrites, noindex
preconditions, HTML escaping, metadata failures and verdict preservation. They
perform no writes to real services. For an explicitly configured test bucket,
`toolbox publish-claim < testdata/completed-claim.json` uploads the fixture and
prints its URL. Change `labels.nodes` to `[{"name":"public"}]` to exercise the
public route. Publishing this fixture is an explicit operator action.
