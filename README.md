# delivery-experiment

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

- `dagger/world.go`: the stable world layer. `Worlds` captures a directory as a
  restic snapshot (`Capture` returns its exact id), restores and judges it
  (`Judge` takes that id, or a label for the newest world with it), and keeps
  worlds in a shared restic repository or an engine-local cache. It also holds
  `playwrightEvidence`, the adapter that turns a Playwright run into the
  contents of a world. It knows nothing of the experiment.
- `delivery/world.sh`, `world.test.sh`, `worlds/`: capture/restore/select by
  tag and id, its test, and frozen fixture worlds.
- `dagger/delivery.go`, `delivery/*.pkl`, `plan|judge|build|audit` specs: the
  first consumer, `RegisteredDelivery`: Jules's plan approval, preregistration
  timing, the cooling threshold, the repair loop and `Reconcile.pkl`'s verdict.
  These stay specific to the experiment.

## The World contract

A world is a directory: `registered.json`, `plan.json`, `work.json`, `spec.txt`,
`plan-run/`, `work-run/`, and optionally `feature/`. Other files are carried
along, so richer evidence (Playwright reports, traces) can join without
changing how worlds are kept. Tags: `check=`, `label=` (provenance), `run=`.

The experiment itself, and run 7 (a frozen falsification case), are described in
[`delivery/README.md`](delivery/README.md).

## Provenance

History is `agent-plugins`' `jev-playwright/` at branch `jev-delivery-nodes`
(PR #383), filtered; the Dagger sources are copied from its `.dagger/`. The
module (`dagger/`) is not yet wired into its own `dagger.json`.
