# investigation fixtures (CIT-392)

Copied unchanged from `test/protondrive/investigation/` (`agent/`, `baseline/`) and
`test/protondrive/fixtures/investigation/restic-diff.ndjson` on
null-hype/agent-plugins#181 (CIT-378). `agent/inputs/` is byte for byte what
`restic dump` restored from Drive in the third live round trip
(run `protondrive-scenario-20261010T013552Z-fefe3f6f`; see that branch's
`test/protondrive/fixtures/README.md`). They are inputs to
`src/lib/restoredInvestigation.spec.ts`; no checker result lives here.
