# Evidence: restic-backup, run 35172465388

Source revision: `d9a581d8fcbabe81b61cf1417fb62dbbb38fb59b`

Run: https://github.com/null-hype/agent-plugins/actions/runs/35172465388

This directory is a direct export -- every file here is machine-generated from
the CI run above by tk-evidence-exporter's `cmd/export`, then repackaged for
this lesson by `cmd/tk-import`. Nothing has been hand-edited.

- `execution.json` -- which run, which job, which steps, and their conclusions.
- `scenario.json` -- the scenario script's own recorded verdict, plus any
  per-check breakdown (empty here -- see the lesson text for why).
- `snapshots.json` -- the restic snapshot(s) this run produced.
- `file-tree.json` -- a `restic ls` manifest of the snapshot: paths and types
  only. No file contents are captured or browsable here.
- `diff.json` -- changed paths between a snapshot pair, when one exists.
- `capability.json` -- capability-spike facts/grants/observations/
  reconciliation flags, when the exported run included that scenario.
- `validation.json` -- the exporter's own structural-validity verdict for
  this package, kept distinct from `scenario.json`'s recorded domain verdict.
