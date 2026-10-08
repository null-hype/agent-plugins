# Retained Vaults transfer case (CIT-339)

This adapter runs the existing `Vaults.test.pkl` against the actual metadata
captured by CI run [35171754006](https://github.com/null-hype/agent-plugins/actions/runs/35171754006).
The observation contains vault names and item titles, without secret values.
It is retained here so replay does not depend on artifact expiry or a live vault.
`manifest.json` pins the inventory SHA-256 and each source file's SHA-256 and git
blob ID. The input scope contains the unmodified declarations, contract,
committed expected PCF and every env/script resource that contract reads.

| State | Source | Newly reproduced check after generating the baseline |
| --- | --- | --- |
| Before reconciliation | `99e902df60f43ae8d9757ac138c92bf6aa78eb7f` | 69/71 assertions; two missing declared items; out of range |
| After reconciliation | `d9a581d8fcbabe81b61cf1417fb62dbbb38fb59b` | 72/72 assertions; in range |

The retained observation shows `claude` in `anthropic.ai` and `linear-release`
in `jingling057`, while the earlier declaration still puts both in
`tidelands.dev`. The original expected PCF also contains the older topology.
The record's transition is the correction of declarations and their consumers
in the second source revision; it is not a fabricated new vault operation.

Run from the repository root with Deno and Pkl on PATH:

```sh
deno run --allow-read --allow-write --allow-env --allow-run=pkl \
  .dagger/internal/devenv-base/pkl/vaults-replay/replay.ts \
  .dagger/internal/devenv-base/pkl/vaults-replay /tmp/vaults-fresh-replay

deno test --allow-read --allow-write --allow-env --allow-run=pkl \
  .dagger/internal/devenv-base/pkl/vaults-replay/replay.test.ts
```

The output directory must be empty. Each state runs in a disposable file copy.
The adapter first checks the original expected PCF, retains that output, then
runs `pkl test --overwrite` in the copy and retains the generated expected PCF.
It runs the contract again against that baseline to assess the facts independently
of the old snapshot mismatch. Overwriting examples does not repair failed facts.
The originals are never rewritten. Scoped inputs and all outputs are saved
before the temporary workspace is removed; `captured/` retains one such run.
Fresh raw output may differ in temporary paths, while answers, findings and
generated baselines must agree.

What transferred: `Question.Question`, `Evidence`, `WorkspaceState`,
`EvaluationRecord`, `Investigation`, transitions and `validInvestigation` all
work unchanged. `Record.pkl` reuses the existing decoder and derives the
assessment with the shared Question helpers. Inventory and baseline contents
are read from retained/generated files, not copied into replay fixtures.
The case adapter only reconstructs resource paths, executes the Vaults contract,
and explains missing declared resources from its actual declaration and observation.

Declarations and observed topology remain separate from the checker assessment.
No forecast was recorded. Historical inventory and source files keep their
origin; new outputs and baselines are reproduced evidence. Original assertion
logs, container images and snapshots are explicit gaps. There is no Dagger
trace or complete-container-backup claim. Delivery stays planned, with no
invented installed feature version: this transfer proves the existing contract
on scoped offline inputs, rather than publishing a new feature milestone.

`pin.ts` is the maintainer acquisition step for the two known commits after
downloading the original `vaults-observed` artifact (ID `10477305436`). It needs
git; ordinary replay and the tests need only the retained bundle and Pkl.
