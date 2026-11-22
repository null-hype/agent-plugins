# Witness for Pkl (VS Code)

Starts the [`witness`](https://github.com/null-hype/witness) language server for
`.pkl` files, so delta-zero's findings in `.witness/run/findings.json` appear in
the Problems panel. Go to Definition on a finding opens its evidence: the part
of the session the handoff dropped.

    go install github.com/null-hype/witness@latest
    cd editor/vscode && npm install
    code --extensionDevelopmentPath="$PWD" ../../examples/yoars-handoff/out-5484 \
      --goto ../../examples/yoars-handoff/out-5484/thread.pkl:54

That opens handoff 5484 from the public YOARS run: 39 findings, and on line 54
`m35-dropped`, whose evidence holds the backend's own note that a blank unit
"will be dropped anyway", which the code it wrote does not do.

Set `witness.serverPath` if `witness` is not on `PATH`.
