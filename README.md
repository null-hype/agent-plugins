# worlds

An agentic delivery harness. It plans, builds and runs a delivery, freezes
what it produced as a **world**, and evaluates a registered claim against that
world.

```
producer  →  World  →  judge  →  verdict
(Playwright)  (restic snapshot)  (Reconcile.pkl)
```

| Repo | Boundary |
| --- | --- |
| [`witness`](https://github.com/null-hype/witness) | **verifies**: durable, source-addressed findings and evidence navigation |
| [`features`](https://github.com/null-hype/features) | **installs**: distributes Witness and checks it in a headless environment |
| this repo | **plans, builds, runs** a delivery and produces reproducible worlds for verification |

## Layout

The store is generic; the experiment is its first user. They share a Dagger
module (`dagger.json`, source in `dagger/`) and nothing else.

| | Store (generic) | Experiment (`registered-delivery`) |
| --- | --- | --- |
| Dagger | `dagger/world.go`: `Store` captures a producer's `/world` (`Capture` returns the exact snapshot id) in a shared restic repository, or an engine-local cache | `dagger/delivery.go`: the checks and the `judged` step |
| Evidence | `dagger/playwright.go`: the adapter that turns a Playwright run into a world's contents | |
| Scripts | `world/world.sh`: `capture`, and `restore` by exact id or label; `world/world.test.sh` | `delivery/judge.sh`: restores a world and judges it with `Reconcile.pkl`; `delivery/judge.test.sh` |
| Data | | `delivery/worlds/`: frozen fixture worlds (run 7, the first passing run) |

The store takes no parameter of the experiment: it is told the `check` name its
worlds are tagged with and nothing else. Jules's plan approval, preregistration
timing, the cooling threshold, the repair loop and `Reconcile.pkl`'s semantics
stay in `delivery/` and `dagger/delivery.go`; `delivery/README.md` describes
the experiment, and `delivery/subject/` is the frozen code Jules is asked to
plan changes to.

```sh
pass-cli run --env-file .env -- dagger check registered-delivery   # produce a world, judge its snapshot
bash world/world.test.sh && bash delivery/judge.test.sh && pkl test delivery/Reconcile.test.pkl
```

## The World contract

A world is a directory the producer makes and the judge reads; the store keeps
any. `registered-delivery`'s is `registered.json`, `plan.json`, `work.json`,
`spec.txt`, `plan-run/`, `work-run/`, and optionally `feature/`; other files are
carried along, so richer evidence (Playwright reports, traces) can join without
changing how worlds are kept. Tags: `check=` (what judges it), `label=`
(provenance), `run=`. Identity is the snapshot's exact id; a label selects the
newest world with it.

The experiment itself, and run 7 (a frozen falsification case), are described in
[`delivery/README.md`](delivery/README.md).

## Provenance

The history is `agent-plugins`' `jev-playwright/` at branch `jev-delivery-nodes`
(PR #383), filtered with `git filter-branch --subdirectory-filter jev-playwright`
and pruned to the delivery harness; the Dagger sources come from its `.dagger/`.
