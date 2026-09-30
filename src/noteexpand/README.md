# Noteexpand detector

This feature installs `noteexpand-detect`, its Pkl evidence/reconciliation
contracts and generated Python bindings. The command takes a collector's
claim and an independent observation and emits the case's diagnostic flags:

```bash
noteexpand-detect evidence.json observation.json
```

Pkl owns the types and reconciliation logic; the command consumes them through
pkl-python and serializes the result. It flags the observed outside-file read
and disagreement between an enforcement claim and that observation.

The application under test is a fixture in `test/noteexpand/toy-app/`. Its
Dockerfile installs the positive consumer at `/opt/toy` and the control
consumer at `/opt/toy-control`; the detector feature installs neither.

`test.sh` checks the detector by itself. The `toy-app` scenario installs the
fixture application, the detector and Jev. It runs the positive/control
canaries, invokes the installed detector, and compares its actual output,
evidence and observations with committed `.pkl-expected.pcf` files. It also
sends the captured sources and claim to installed mock Jev.

Scenario runs retain source bytes, claim, observation, detector output,
stdout/stderr and Pkl JUnit results in `noteexpand-records`. Exact Jev requests,
raw responses and scores are retained too. The scenario makes no model-service
calls.

```bash
devcontainer features test -f noteexpand -i mcr.microsoft.com/devcontainers/base:ubuntu .
pkl-gen-python -o src/noteexpand/lib src/noteexpand/pkl/Evidence.pkl src/noteexpand/pkl/Reconcile.pkl
```
