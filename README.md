# Agent capability governance: executable evidence

<!-- CANONICAL DESCRIPTION: keep identical to docs/launch/canonical-description.md -->
Agent capabilities (MCP servers, skills, plugins, connectors) can each be
acceptable on their own and still be unsafe once composed, and ordinary merge
checks and green tests do not show it. This project turns capability
governance into executable, typed checks that flag the conflict, and the
reasons and facts behind it, before a capability is accepted.

> Research prototype. Scenarios are synthetic or exported from this project's
> own CI. Not a production control. See [limitations](#limitations).

<!-- TODO: screenshot of the chapter 3 diagnostic hover (CIT-169) -->

## Try it

```bash
cd tutorial-app
npm install
npm run dev
```

Open the local URL and start at chapter 3, "CI Evidence & Capability
Decisions". Lesson 5 ("The wrong-way peninsula") is the core example: a
test that is green and governed by nothing.

## Inspect the evidence

- Core scenario: [`docs/launch/aha-scenario.md`](docs/launch/aha-scenario.md)
- Claim to evidence table: [`docs/launch/claims-evidence.md`](docs/launch/claims-evidence.md)
- Runnable proof, no credentials needed:
  `cd capability-spike && pkl test pkl/Inventory.test.pkl pkl/Reconcile.test.pkl`
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

- Synthetic and self-exported scenarios; no evaluation on third-party MCP
  servers or plugins.
- Proton Pass integration records to a local ledger, not a real vault.
- Diagnostics render in a TutorialKit preview, not a full language server.
- See [`tutorial-app/GAP-IMPLEMENTATION.md`](tutorial-app/GAP-IMPLEMENTATION.md)
  for the scoped limits of the tutorial slice.

## Contact

<!-- TODO(CIT-166): add the published contact address or booking link -->
To discuss applying this to an agent system, open an issue on this
repository until a contact address is published.

## Repository notes

This repo also hosts devcontainer features and Dagger modules; see
[`docs/devcontainer-features.md`](docs/devcontainer-features.md).
