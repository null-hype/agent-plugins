# AGENTS.md

This repository is a research prototype for agent capability governance. It
hosts devcontainer Features (`src/<feature>`, tested under `test/`), Dagger
modules (`.dagger/`, `bountybench-dagger-*/`), Pkl contracts and goldens
(`capability-spike/`, `src/*/pkl`, `*.test.pkl`), and a TutorialKit/Astro +
Storybook site (`tutorial-app/`, published as www.tidelands.dev).

Process notes for the bountybench modules and the delegated-agent lanes live
in `CLAUDE.md`. Feature test conventions live in
`.claude/skills/devcontainer-feature-testing/SKILL.md`. Read both before
reviewing changes in those areas.

## Review guidelines

The maintainer's review comments are mostly about design, not edge cases: a
PR that adds new machinery where an existing path already does the job is the
most common reason a change is rejected. Weigh those findings as highly as
correctness bugs. Mark a finding P1 when it would make the maintainer ask for
the change to be redone, not only when it would crash.

### Reuse before reinvention

- Flag new scripts, runners, workflows or modules that duplicate something the
  repo already provides. Existing pieces include the `jev` feature (Jev CLI),
  the `pass-cli` feature (secrets and skills), `playwright-cli`, the
  `linear-agent` TypeScript module, the Dagger modules in `.dagger/`, and the
  devcontainer CLI's own scenario runner. Name the existing piece in the
  finding.
- The intended split is: Features install the tools and fixtures, scenario
  tests exercise them, and Dagger runs headless experiments on top. Flag a
  hand-rolled experiment runner, a second test harness, or a Dagger function
  that copies in files a Feature should install.
- Flag code that shells out (`subprocess`, `execSync`, spawning `pkl` from
  TypeScript or Python) where an installed CLI, a language binding, or a
  Feature install step would do. Pkl types should be consumed through the
  existing generated bindings (`*.pkl.ts`, `pkl-go`).
- Flag a new GitHub workflow, or a new branch inside an existing one, when the
  existing matrix in `test.yaml`/`test-global.yaml` or `paths-filter` mapping
  could carry it. New workflows tend to sprawl.
- Flag snapshot or history handling that rebuilds what restic already gives
  (snapshots, `restic diff --json`).

### Tests should test the feature, not the machinery

- Flag tautological tests: a scenario that sets up the very environment it
  then asserts on, or exports variables the Feature should have baked into the
  image. The behaviour belongs in `install.sh`; the test only invokes it.
- Flag tests that check that another feature or service works as advertised
  (testing `jev` through a different feature), tests that rename or count
  files, and tests of the requirements or the experiment scaffolding rather
  than the user-facing result. Prefer assertions on actual outputs, such as a
  claim falling within an expected confidence range.
- Follow the devcontainer test layout: `test/<feature>/test.sh`,
  `test/<feature>/scenarios.json` + `<scenario>.sh`, `test/_global/` only for
  combinations no single feature owns. Scenario names describe the case under
  test, not "experiment" or the agent. Test-only code (Playwright specs,
  fixtures, `package.json`) belongs under `test/`, not shipped in `src/`.
- A scenario must pass on a clean checkout. Flag scenarios that depend on
  gitignored or generated files (HARs, replay JSON) that nothing in the
  scenario or Feature produces.
- Pkl goldens live beside their tests as `*.pkl-expected.pcf`. Flag duplicate
  JSON answer keys, and flag `-expected.pcf` files unrelated to the change's
  stated purpose.

### Feature contracts

- `devcontainer-feature.json` is the public contract once `release.yaml`
  publishes it. Check that `version` is valid SemVer and is bumped when
  `install.sh` or installed files change, that runtime needs such as Node are
  declared in `dependsOn`, and that ordering uses `installsAfter`.
- Values that vary by scenario (tags, model, effort) should be Feature
  options, not hardcoded in test scripts or Dockerfiles.
- `install.sh` runs as root at build time: flag paths resolved through `~` or
  `$HOME` that will point at `/root` instead of the container user.

### Secrets and credentials

- Secrets are referenced as `pass://vault/item/FIELD` in committed `.env`
  files and resolved at run time with `pass-cli run --env-file <file> --`.
  Flag any literal secret, any `source` of a `pass://` reference, and any
  token baked into an image via `ARG`/`ENV`.
- `pass-cli run` calls should set `PROTON_PASS_AGENT_REASON`. Flag new
  bypass flags or forks around missing vault access; the fix is to change the
  token's vault access and handle the error.

### Paths and portability

- Flag hardcoded absolute paths (`/workspace/...`, a developer's home) and
  needless relative paths in devcontainer and Pkl files. Config should load
  from conventional locations.
- Flag `-p`/`--privileged` and similar flags that are added without a stated
  reason.

### Scope and docs

- Flag changes unrelated to the PR's linked issue (often a `CIT-`/`JIN-`
  Linear id), for example an unrelated feature added to a CI matrix. Suggest
  splitting them out.
- Flag README or docs prose that describes intentions without a command,
  test, or evidence link behind it. Claims in `docs/launch/` should map to an
  entry in `docs/launch/claims-evidence.md`.
- `docs/investigations/` and `tutorial-app/evidence/` hold retained evidence.
  Flag edits that rewrite recorded results instead of adding a new record.

### Not findings

- Files under `capability-spike/worker/fixtures_invalid/` and the tutorial's
  lesson fixtures are deliberately invalid or vulnerable. Do not report them
  as security issues.
- `src/cve-2026-66066/vendor/` is vendored; its own `AGENTS.md` describes a
  different repository. Review it only for how this repo uses it.
- Codex Cloud has no Docker or Dagger engine. Do not ask for `dagger call` or
  `devcontainer features test` output from the author; CI and the supervisor
  pass run those.
