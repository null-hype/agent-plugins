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

Each paragraph below is one rule. Report a violation as P1 when it would make the maintainer ask for the change to be redone, even if nothing crashes.

### C1. Reuse before reinvention

Flag new scripts, runners, workflows or modules that duplicate something the repo already provides, and name the existing piece in the finding: the `jev` feature (Jev CLI), the `pass-cli` feature (secrets and skills), `playwright-cli`, the `linear-agent` TypeScript module, the Dagger modules in `.dagger/`, or the devcontainer CLI's own scenario runner.

### C2. Features install, scenarios exercise, Dagger explores

Features install the tools and fixtures, scenario tests exercise them, and Dagger runs headless experiments on top. Flag a hand-rolled experiment runner, a second test harness, or a Dagger function that copies in files (`WithFile`) a Feature should install.

### C3. No subprocess glue

Flag code that shells out (`subprocess`, `execSync`, spawning `pkl` from TypeScript or Python) where an installed CLI, a Feature install step, or the existing Pkl bindings (`*.pkl.ts`, `pkl-go`) would do.

### C4. Extend CI, don't fork it

Flag a new GitHub workflow, or a new branch inside an existing one, when the existing matrix in `test.yaml`/`test-global.yaml` or its `paths-filter` mapping could carry the change. Flag CI that filters or rewrites `scenarios.json` instead of using the conventional test locations.

### C5. Use restic for history

Flag snapshot, history, or diff handling that rebuilds what restic already provides (snapshots, tags, `restic diff --json`).

### C6. No tautological tests

Flag a scenario that sets up the very environment it then asserts on, or exports variables the Feature should have baked into the image. The behaviour belongs in `install.sh`; the test only invokes it.

### C7. Test the user-facing result, not the machinery

Flag tests that check another feature or service works as advertised (for example testing `jev` through a different feature), tests that rename or count files, and tests of the requirements or experiment scaffolding. Prefer assertions on actual outputs, such as a claim falling within an expected confidence range.

### C8. Devcontainer test layout

Tests follow `test/<feature>/test.sh`, `test/<feature>/scenarios.json` + `<scenario>.sh`, and `test/_global/` only for combinations no single feature owns. Scenario names describe the case under test, not "experiment" or the agent. Flag test-only code (Playwright specs, fixtures, `package.json`) shipped under `src/`.

### C9. Scenarios pass on a clean checkout

Flag scenarios that depend on gitignored or generated files (HARs, replay JSON, recordings) that nothing in the scenario or Feature produces.

### C10. Pkl goldens

Pkl goldens live beside their tests as `*.pkl-expected.pcf`. Flag duplicate JSON answer keys, and `-expected.pcf` files unrelated to the change's stated purpose.

### C11. Feature metadata is a published contract

`release.yaml` publishes `devcontainer-feature.json`. Check that `version` is valid SemVer and is bumped when `install.sh` or installed files change, that runtime needs such as Node are declared in `dependsOn`, and that ordering uses `installsAfter`.

### C12. Options over hardcoded values

Values that vary by scenario (tags, model, effort, vault names) should be Feature options. Flag them when hardcoded in test scripts or Dockerfiles.

### C13. Build-time user paths

`install.sh` runs as root at build time. Flag paths resolved through `~` or `$HOME` that will point at `/root` instead of the container user.

### C14. Secrets go through pass-cli

Secrets are referenced as `pass://vault/item/FIELD` in committed `.env` files and resolved at run time with `pass-cli run --env-file <file> --`, with `PROTON_PASS_AGENT_REASON` set. Flag any literal secret, any `source` of a `pass://` reference, any token baked into an image via `ARG`/`ENV`, and new bypass flags around missing vault access (the fix is the token's vault access plus handling the error).

### C15. No hardcoded or needless paths

Flag hardcoded absolute paths (`/workspace/...`, a developer's home) and needless relative paths in devcontainer and Pkl files; config should load from conventional locations. Flag `-p`/`--privileged` and similar flags added without a stated reason.

### C16. Stay in scope

Flag changes unrelated to the PR's linked issue (usually a `CIT-`/`JIN-` Linear id), for example an unrelated feature added to a CI matrix, and suggest splitting them out.

### C17. Docs need evidence

Flag README or docs prose that describes intentions without a command, test, or evidence link behind it. Claims in `docs/launch/` should map to an entry in `docs/launch/claims-evidence.md`.

### C18. Retained evidence is append-only

`docs/investigations/` and `tutorial-app/evidence/` hold retained evidence. Flag edits that rewrite recorded results instead of adding a new record.

### C19. Not findings

Files under `capability-spike/worker/fixtures_invalid/` and the tutorial's lesson fixtures are deliberately invalid or vulnerable; do not report them as security issues. `src/cve-2026-66066/vendor/` is vendored and its `AGENTS.md` describes a different repository. Codex Cloud has no Docker or Dagger engine, so do not ask the author for `dagger call` or `devcontainer features test` output; CI and the supervisor pass run those.
