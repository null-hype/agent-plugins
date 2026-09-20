# Agent capability governance: executable evidence

<!-- CANONICAL DESCRIPTION: keep identical to docs/launch/canonical-description.md -->
Agent capabilities (MCP servers, skills, plugins, connectors) can pass
review and green tests while the approval they seem to imply never happened.
This project turns capability governance into executable, typed checks that
compare what a worker declared, what a supervisor granted and what actually
happened, and flag the disagreement, with the facts behind it, before a
capability is accepted.

> Research prototype. Scenarios are synthetic or exported from this project's
> own CI. Not a production control. See [limitations](#limitations).

## See it in two minutes

[`docs/launch/demo.md`](docs/launch/demo.md): a green test, the approval it
lacks, the diagnostic that says so, and the repair. Needs `pkl` and Go, no
credentials:

```bash
cd capability-spike
pkl test worker/fixtures_invalid/bypassed_gate.pkl   # green
go run .                                             # step 9 flags it
```

## Try the interactive lessons

```bash
cd tutorial-app && npm install && npm run dev
```

Chapter 3, lesson 5 ("The wrong-way peninsula") renders the same diagnostic as
an editor hover. It opens with background before the failure; the demo above
is the short path.

## Inspect the evidence

- Demo walkthrough: [`docs/launch/demo.md`](docs/launch/demo.md)
- Core scenario: [`docs/launch/aha-scenario.md`](docs/launch/aha-scenario.md)
- Claim to evidence table (link, command, expected result, limit): [`docs/launch/claims-evidence.md`](docs/launch/claims-evidence.md)
- Source: [`capability-spike/`](capability-spike/README.md) (gate, grants,
  reconciliation), [`tk-evidence-exporter/`](tk-evidence-exporter/README.md)
  (CI evidence into lessons), [`tutorial-app/`](tutorial-app/) (lessons and
  diagnostics)

## Architecture at a glance

```
worker fact (Pkl) ──► Ledger.pkl gate ──► GovernanceDiagnostic (typed)
                          ▲                      │
         supervisor grants┘                      ▼
 observed materialization ──► Reconcile.pkl ──► editor hover / CodeLens
```

## Limitations

- Two independently acceptable changes becoming unsafe together is not
  demonstrated; the demo shows one worker's fact, grant and observation
  disagreeing.
- The `boundary-bypassed` flag is a text search for `Ledger.checkAccess(`,
  not proof of runtime enforcement.
- Synthetic and self-exported scenarios; no evaluation on third-party MCP
  servers or plugins.
- Proton Pass integration records to a local ledger, not a real vault.
- Diagnostics render in a TutorialKit preview, not a full language server.
- See [`tutorial-app/GAP-IMPLEMENTATION.md`](tutorial-app/GAP-IMPLEMENTATION.md)
  for the scoped limits of the tutorial slice.

## Contact

To discuss applying this to an agent system, or consulting, collaboration or
funding, [open an issue with the form](https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml).
It is public, so leave out secrets and private details. This is the one
contact route; the launch status is in
[`docs/launch/publication-status.md`](docs/launch/publication-status.md).

## Repository notes

This repo also hosts devcontainer features and Dagger modules; see
[`docs/devcontainer-features.md`](docs/devcontainer-features.md).
