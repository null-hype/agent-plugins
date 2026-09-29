# Evidence format and validator (`evidence`)

The contract between the reasoning agent and everything downstream (Jev client, scoring). Contains no case data.

An evidence file is JSON: `{"findings": [...]}`. Each finding names a `component`, a `source_path` (relative to the image root), an `excerpt`, the `never` it implies, and `enforced` (whether anything enforces it). `{"findings": []}` ("no findings") is valid. The schema is `evidence.schema.json`, installed to `/usr/local/share/evidence/`.

```bash
evidence-validate evidence.json                 # format only
evidence-validate --root /path/to/image evidence.json   # format + grounding
```

Grounding: each `excerpt` must appear verbatim in the file at `source_path` under `--root`; paths that escape the root (including via symlinks) fail. Exit 0 = ok, 1 = invalid/ungrounded (one problem per line on stderr), 2 = usage.
