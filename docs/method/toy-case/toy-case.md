# Noteexpand toy scenario

The [noteexpand feature](../../../src/noteexpand/README.md) installs the detector
and its Pkl contracts/bindings. The toy application is the scenario fixture in
[`test/noteexpand/toy-app`](../../../test/noteexpand/toy-app), installed by that
scenario's Dockerfile.

The scenario feeds a caller-supplied note containing an include of a marker
outside the note directory to both consumers. The positive consumer reads the
marker; the control refuses it. It then calls the installed `noteexpand-detect`
with the typed claim and independent observation. Native Pkl tests and committed
`.pkl-expected.pcf` files check the actual detector output.

```bash
devcontainer features test -f noteexpand -i mcr.microsoft.com/devcontainers/base:ubuntu .
```

This toy has no real CVE identifier. Each real CVE detector can follow the same
pattern: detector in `src/<feature>`, application under test in
`test/<feature>/<scenario>`, and expectations beside the scenario tests.
