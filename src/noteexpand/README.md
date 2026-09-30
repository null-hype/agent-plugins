# Noteexpand composition case

This feature installs the toy note renderer at `/opt/toy`, its Pkl evidence
and reconciliation contracts at `/usr/local/share/noteexpand/pkl`, and generated
Python bindings at `/usr/local/share/noteexpand/lib`.

The expander supports `@include PATH`. Its README warns that caller-supplied
notes can read files outside their directory. The default consumer renders the
caller input unchanged; `confineIncludes: true` installs the control consumer
that refuses those includes.

The tests are owned by this feature:

- `test.sh` executes the installed default consumer with an outside-file marker.
- `control` tests the `confineIncludes` option against the same canary.
- `with_jev` installs this feature and Jev, checks the evidence with Pkl, and
  sends the captured sources and claim to installed mock Jev.

The typed claim is a recorded test input. The canary supplies an independent
observation; `Reconcile.pkl` exposes disagreement between them. Expected
evidence, observed behavior and diagnostics are committed as Pkl golden files
under `test/noteexpand`, outside the installed application.

Each run retains the application bytes, claim, observation, stdout/stderr and
Pkl JUnit results in the test workspace's `noteexpand-records` directory. The
Jev scenario also records the exact request, raw response and returned score.
The tests make no model-service calls.

```bash
devcontainer features test -f noteexpand -i mcr.microsoft.com/devcontainers/base:ubuntu .
pkl-gen-python -o src/noteexpand/lib src/noteexpand/pkl/Evidence.pkl
```
