You're doing one hourly review-and-merge pass over pending
`bountybench-dagger-*` work from two lanes: container-use environments (the
Haiku worker) and Codex PRs the top-level interactive session has pulled
locally (see Lane 2 below — you have no Linear access and never talk to
Codex directly). You did not build any of this work — treat every
environment's log, every Codex self-report, and every PR description as a
claim to verify, not a fact. Same rule for both lanes: a clean integration
check does not imply correctness, and a builder's "done" does not either.
Both checks below are required regardless of which lane produced the work.

## Lane 1: container-use environments

1. `container-use list` — for every environment not yet merged into
   `bountybench-dagger-modules`, do the following.
2. `container-use log <env>` and `container-use diff <env>` to see what
   happened and what changed. `container-use checkout <env>` to pull the
   branch locally.
3. Integration check: apply the branch with GitButler (`but`) and confirm
   it applies cleanly against `bountybench-dagger-modules` and any other
   environment you've already applied this pass. A conflict here means
   leave it — do not attempt to auto-resolve. If you're unsure of the
   right `but` invocation, run `but agent setup --print` (or `but skill
   install --global` once, if the skill files aren't already installed)
   rather than guessing flags — GitButler ships its own agent-integration
   steering docs for exactly this.
4. Correctness check: **independently re-run `dagger call bootstrap`**
   inside the checked-out worktree yourself, from scratch. Do not accept
   the environment's own log as evidence this passed. This is the actual
   bounty invariant — if `Bootstrap` doesn't reproduce the exploit and
   pass its own verify condition when you run it, the environment fails
   this check regardless of what its history claims.
5. Only merge and push (`bountybench-dagger-modules`) if both step 3 and
   step 4 pass. If either fails, leave the environment untouched (don't
   delete it) and note why in your report — a later worker run may
   `environment_open` it and fix it forward.
   - Do the actual push with plain `git push`, not `but push` / any
     GitButler-driven push. GitButler operates at git's plumbing layer and
     is not guaranteed to invoke porcelain hooks the way the `git` CLI
     does, so a GitButler-originated push could silently skip the `hk`
     `pre-push` hook (and anything added to it later). Use GitButler only
     for the step-3 integration check; land the final merge with plain git.
   - If step 3 or step 4's result is ambiguous rather than a clean pass or
     fail (e.g. a conflict that looks like it might be a false positive, or
     a `dagger call bootstrap` failure that might be flaky/environmental
     rather than a real regression), invoke the `advisor` subagent with
     what you found and get a second opinion before deciding. Don't invoke
     it for routine clear-cut passes — it's for the genuinely unclear
     cases, not every environment.

## Lane 2: delegated-agent PRs (file handoff, no Codex/Jules access)

You have no Linear access and no Jules API access in this pass — the
top-level interactive session owns both agent relationships (creating
delegations, reading their replies/session activity, posting feedback back
to them). Your only input for this lane is
`.dagger/internal/devenv-base/bountybench-loop/pending-agent-prs.json`
(gitignored, host-local state — not committed), a JSON array the top-level
session appends to after it pulls a delegated agent's PR locally. Each entry
looks like one of:

```json
{"agent": "codex", "app": "undici", "branch": "codex/undici", "linear_issue": "CIT-24", "pr_url": "https://github.com/.../pull/48"}
{"agent": "jules", "app": "gradio", "branch": "jules/gradio", "jules_session_id": "sessions/314159", "pr_url": "https://github.com/.../pull/52"}
```

`agent` is always one of `"codex"` or `"jules"` — both produce a plain
GitHub PR from a sandbox with no Dagger engine, so both get identical
treatment here; the only difference is which field (`linear_issue` vs.
`jules_session_id`) the top-level session needs back in your report to know
where to post feedback.

1. Read that file (`jq . pending-agent-prs.json` or plain `cat` if it's
   small/absent — treat a missing file as an empty backlog, not an error).
2. For each entry: confirm `branch` exists locally (`git branch --list`;
   fetch it yourself from `pr_url`'s head ref if it doesn't). Then run the
   same two checks as Lane 1 — GitButler integration check against
   `bountybench-dagger-modules` (step 3 above), then an independent `dagger
   call bootstrap` re-run from scratch (step 4 above). Neither Codex nor
   Jules could run this itself (no engine in either sandbox — see CLAUDE.md's
   "Delegated-agent lanes"), so this is the *first* real execution of the
   module, not a re-check of something already verified.
3. Merge and push (plain `git push`, same reasoning as Lane 1) only if both
   checks pass. Either way, remove that entry from `pending-agent-prs.json`
   (via Bash — `jq`/`sed` in place) once you've recorded its outcome in your
   report; leaving it there would make a future pass redo the same check.
4. You do not talk to Codex, Linear, or Jules yourself. Your report (the
   "Every pass" section below) must include, per entry: `agent`, app, the
   `linear_issue` or `jules_session_id` (whichever the entry has), verdict,
   and — if it failed — the actual `dagger call bootstrap` output or
   GitButler conflict text verbatim, so the top-level session can relay
   something concrete back to whichever agent produced it, rather than a
   vague "didn't work."
5. Same ambiguity rule as Lane 1: if a failure looks possibly
   flaky/environmental, or a GitButler conflict looks like a false positive,
   consult the `advisor` subagent before deciding the verdict.

## Every pass, regardless of lane

1. **Regardless of whether anything merged this pass**, run the restic
   backup of `~/.claude` and `~/.config/container-use` yourself before
   ending. Don't rely solely on the `hk` `pre-push` hook firing — it only
   fires on an actual push, and a pass with nothing to merge still leaves
   in-progress environments (and pending `pending-agent-prs.json` entries)
   that need covering.
2. End with a short report: per environment and per `pending-agent-prs.json`
   entry, which app, verdict (merged / left-and-why), and confirmation the
   backup ran. For Lane 2 entries, include the verbatim failure output per
   step 4 above — the top-level session reads this report to decide what to
   relay back to whichever agent (Codex or Jules) produced the PR.

You are verifying and integrating, not fixing bugs in someone else's work —
don't modify environment contents or push fixes into a delegated agent's PR
yourself, beyond what GitButler's apply and the re-run of `dagger call
bootstrap` require. You never talk to Codex, Linear, or Jules directly —
that's the top-level session's job, using this report as its input.
