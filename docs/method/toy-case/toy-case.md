# Noteexpand toy case

The executable case is the [noteexpand feature](../../../src/noteexpand/README.md).
Its application, evidence types and reconciliation check live under
`src/noteexpand`; its positive, control and Jev integration tests live under
`test/noteexpand`.

The test feeds a caller-supplied note containing an include of a marker outside
the note directory to the installed application. The positive consumer reads
the marker; the control consumer refuses it. Pkl reconciles the independently
observed output with a typed enforcement claim, and its committed
`.pkl-expected.pcf` files provide the expected evidence and diagnostics.

Run the case through the normal feature tests:

```bash
devcontainer features test -f noteexpand -i mcr.microsoft.com/devcontainers/base:ubuntu .
```

The toy has no real CVE identifier. Real CVE cases can follow this same feature
and scenario structure. Documentation does not contain a second copy of the
application or answer keys.
