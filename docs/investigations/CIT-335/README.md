# Installed checker deliveries

CIT-335 delivers `deleted-trace` against two pinned checker states using the
existing CVE feature and the existing forensics scenario. These are checker
reproductions over retained evidence; they do not rerun the Rails exploit.

| Feature delivery | Checker state / source commit | Deleted trace | Generic crash control |
| --- | --- | --- | --- |
| `20261008.0811` | S1 / `20aafd26372a832224be824f72f4a615ee671094` | 28/28 assertions still pass | Still passes |
| `20261008.0812` | S2 / `8d097c8e16bd1db44d5d4f558ad99938585e1001` | 56/56 assertions still pass | Checker fails |

Both versions also fail on a missing required observation. A passing deleted
trace run is a collected negative answer (`out-of-range`), while unreadable
checker output is a missing answer (`not-collected`) and fails collection.
Tampered pinned inputs are rejected before execution.

## Reproduce and retain

From the repository root:

```sh
deno run --allow-read scripts/package-cve-questions.ts --check
dagger call cve-checker export --path ./build/cve-checker
```

The Dagger command builds the `checker` target of
`test/_global/cve-2026-66066-forensics/Dockerfile`, which uses the existing
investigation's Node image and installs only the pinned subject inputs under
`/case`. It then installs each version of the feature in its own container and
executes the installed capture command. Expectations and failure tests live
under `/test`, outside the subject and feature tooling. No credentials are used.

The export contains one directory per delivered version with `capture.json`,
typed `record.json`, installation/runtime evidence, the exact pinned and mutated
inputs, raw checker outputs, answers and retained PR/review declarations. The
top-level `record.json` is the shared `Question.Investigation`: the same question
across S1 and S2 with a transition prompted by S1's review finding. File URIs in
this combined record are relative to the exported directory. Evidence hashes are
checked against the retained files by the scenario test.

Export before discarding the run. Dagger's trace and cache are execution
provenance, not durable backup. Image digests and snapshot IDs remain explicit
gaps pending CIT-336's retention/restore work. CI checks these runs but does not
upload their evidence bundle. No live vault registration or agent turn is part
of this deterministic checker test.

## Package a delivered version

The checked-in feature defaults to `20261008.0812`. Its `deliveries.json` lists
the two review rounds; the packaging command selects one without including
subject inputs or expected answers in the feature archive:

```sh
deno run --allow-read --allow-write scripts/package-cve-questions.ts --check \
  --delivery 20261008.0811 --output /tmp/cve-feature-20261008.0811
npx @devcontainers/cli features package /tmp/cve-feature-20261008.0811 \
  --output-folder /tmp/cve-package-20261008.0811
```

Use `20261008.0812` and fresh output directories for the second version.

`shared/Question.pkl` and `shared/Jev.pkl` are generated package copies of the
canonical modules in `src/jev/pkl`, checked byte for byte by the packaging
command. Installation restores a private `src/{cve-2026-66066,jev}` tree so
source-relative imports preserve Pkl's nominal type identity. The question tree,
the existing `round.ts` register implementations and stub tests run from this
installed tree. Existing forensics scripts and skill links stay at their
original paths. Private Pkl 0.32.1 and Deno 2.9.7 binaries avoid replacing other
features' runtimes.

The existing replay imports the feature's verified loader, selected question
and record decoder. Its historical records remain planned deliveries; new
scenario captures are separately labelled reproduced and captured. The original
declarations, unresolved forecasts and unavailable reviewer output retain their
own provenance. This slice leaves viewer fixture replacement to CIT-337.
