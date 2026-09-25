# Agent capability governance: executable evidence

<!-- CANONICAL DESCRIPTION: keep identical to docs/launch/canonical-description.md -->
Agent capabilities and automated changes can merge cleanly and pass tests while violating the business and security rules they seem to satisfy. This project turns capability governance into inspectable, typed checks that evaluate proposals before acceptance, flag policy violations with their underlying evidence, and record human supervisor exceptions without overwriting audit history.

> Research prototype. Scenarios are either computed on synthetic fixtures or exported from this project's own CI runs. Not a production control. See [limitations](#limitations).


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

Start with **[Budget Authority](https://null-hype.tidelands.dev/part-3/proposal-p-against-the-budget/1-jev-types-the-answer)**:
a confident answer, a clean merge, a failed budget check, and a scoped supervisor
exception. The replay is scripted; the merge and arithmetic are computed, and
authority enforcement is simulated. The tutorial then links to a recorded
diagnostic, the merge experiment, and hands-on reconciliation labs.

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
- Scripted turn sequence with computed git merges and budget evaluations; the approval boundary is simulated.
- The `boundary-bypassed` flag is a static search for `Ledger.checkAccess(`, not proof of runtime enforcement.
- Synthetic and self-exported scenarios; no evaluation against unconstrained third-party agent swarms.
- Proton Pass integration records to a local ledger, not a live production vault.
- Diagnostics render in a TutorialKit/Monaco preview, not a production language server.
- See [`tutorial-app/GAP-IMPLEMENTATION.md`](tutorial-app/GAP-IMPLEMENTATION.md) for the scoped limits of the tutorial slice.

## Contact

We support two direct routes depending on your context:

- **Public Collaboration & Reproductions:** [Open an issue with the template](https://github.com/null-hype/agent-plugins/issues/new?template=apply-this.yml) to discuss open-source agent setups, reproduce checks, or ask technical questions. (Public; do not include secrets or proprietary architecture details).
- **Private Enquiries (Consulting, Research, Funding, Hiring):** Email [`public.rant@pm.me`](mailto:public.rant@pm.me) to discuss internal agent systems, confidential evaluation, or advisory engagements. Please describe the workflow context; do not send credentials, API keys, or unredacted secrets in an initial message.


## Repository notes

This repo also hosts devcontainer features and Dagger modules; see
[`docs/devcontainer-features.md`](docs/devcontainer-features.md).
