You're doing one iteration of an ongoing effort to bootstrap Dagger modules
for apps in the bountybench/bountytasks corpus. Work in
`/workspaces/devenv-base-gce`. Read `CLAUDE.md` at the repo root first — the
"bountybench-dagger-* modules" section there has the module shape, the
step-by-step process, the budget guidance, and how work here gets tracked
and merged. Follow it.

This run:

1. Run `container-use list` to see existing environments, and check which
   `bountybench-dagger-*` directories already exist / are merged into
   `bountybench-dagger-modules`. Pick the next uncovered app from the
   corpus per the CLAUDE.md process (step 1).
2. If a previous run left a **partial** environment for an app (per its
   `container-use log`) and it looks close to done, `environment_open` it
   and finish that instead of starting a new app — partial work in
   progress takes priority over breadth.
2a. New environments must be created with `base_image:
   ghcr.io/null-hype/devenv-agent:<tag>` per CLAUDE.md step 7, not a bare
   base image plus hand-rolled `setup_commands` -- that image already
   carries a correctly pinned `dagger` CLI, container-use, docker, and
   git. If you're continuing a **partial** environment created before this
   was the rule, first run `dagger version` inside it; if it isn't exactly
   the pinned version from CLAUDE.md (`v0.21.8` as of this writing), that's
   your first fix -- update the environment's `setup_commands` to pin it
   explicitly (`DAGGER_VERSION=v0.21.8` on the install script) or, better,
   switch its `base_image` to the pinned `devenv-agent` image instead.
   Don't try other CLI versions ad hoc. A `dagger call` failure whose
   error mentions a GraphQL schema mismatch (e.g. "Cannot query field ...
   on type 'TypeDef'") is this exact issue, not a bug in the module you're
   working on -- confirm by running `dagger call bootstrap` against the
   known-good `bountybench-dagger` module; if that also fails the same
   way, it's the version pin, stop guessing and fix the pin.
3. Do all work — file edits, `dagger init`, `dagger call`, everything —
   through container-use environment tools (`environment_create` /
   `environment_open`, `environment_run_cmd`, `environment_file_*`). Never
   run `git` yourself and never push; the environment's branch and commit
   history come from ordinary container-use use. Name/title the
   environment after the app per CLAUDE.md.
4. End with a short report: the environment ID/title, which app, what
   state it's in (done / partial+why / blocked+why), and roughly how many
   tool calls you used. Do not skip naming the environment ID — it's the
   only way the supervisor step finds this run's work.

If you run out of turns before `Bootstrap` + `Serve` pass, that's fine —
leave the environment as-is with whatever works. Partial work is fine; a
supervisor picks up review and merging separately, not you.

Do not touch any other `bountybench-dagger-*` environment or directory,
and do not touch anything outside the `bountybench-dagger-*` scope and
`CLAUDE.md`.
