# Installed checker delivery

CIT-335 delivers `deleted-trace` against two pinned checker states using the
existing CVE feature and the existing forensics scenario. These are checker
reproductions over retained evidence; they do not rerun the Rails exploit.

CIT-335 delivers project milestone `20261008.0811`. S1/S2 are historical
checker revisions (PRs 117/118), not consecutive project milestones. Both are
reproduced in this one delivery. `20261008.0812` remains reserved for CIT-336's
retention and restoration; no package or record here claims that milestone.

| Project delivery (`Delivery.version`) | SemVer package (`devcontainer-feature.json`) | Checker state / source commit | Deleted trace | Generic crash control |
| --- | --- | --- | --- | --- |
| `20261008.0811` | `0.2.0-s1` | S1 / `20aafd26372a832224be824f72f4a615ee671094` | 28/28 assertions still pass | Still passes |
| `20261008.0811` | `0.2.0-s2` | S2 / `8d097c8e16bd1db44d5d4f558ad99938585e1001` | 56/56 assertions still pass | Checker fails |

The timestamp is a delivery identifier, not a package version. The feature
advances from `0.1.0` to two initial-development `0.2.0` prereleases with valid
[SemVer](https://semver.org/) identifiers. `deliveries.json` maps the milestone,
package version, checker state and finding. Each installed `delivery.json` and
`installed-feature.json` retains that mapping, alongside the actual package
metadata. The shared record still uses its timestamp delivery field; distinct
state IDs identify the two records. The shared validator permits multiple
historical states in one project delivery and still requires distinct state
IDs, source-changing transitions and the same question.

Both packages also fail on a missing required observation. A passing deleted
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
`/case`. It then installs each package of the feature in its own container and
executes the installed capture command. Expectations and failure tests live
under `/test`, outside the subject and feature tooling. No credentials are used.

The export contains one directory per historical state (`S1`, `S2`) with `capture.json`,
typed `record.json`, installation/runtime evidence, the exact pinned and mutated
inputs, raw checker outputs, answers and retained PR/review declarations. The
top-level `record.json` is the shared `Question.Investigation`: the same question
across S1 and S2 with a transition prompted by S1's review finding. File URIs in
this combined record are relative to the exported directory. Evidence hashes are
checked against the retained files by the scenario test.

Capture requires an absent or empty output directory. It rejects any nonempty
destination before writing or running the checker, preserving previous evidence.
A failed collection retains its new `not-collected` record in that fresh directory;
retry with another fresh directory. Regression tests cover a successful bundle
retried with an unreadable checker, arbitrary stale files, and an existing empty
directory.

Export before discarding the run. Dagger's trace and cache are execution
provenance, not durable backup. Image digests and snapshot IDs remain explicit
gaps pending CIT-336's retention/restore work. CI checks these runs but does not
upload their evidence bundle. No live vault registration or agent turn is part
of this deterministic checker test.

## Package a checker state

The checked-in feature defaults to package `0.2.0-s2`, in delivery
`20261008.0811`. Select a package version from `deliveries.json`; subject inputs
and expected answers remain outside its archive:

```sh
deno run --allow-read --allow-write scripts/package-cve-questions.ts --check \
  --delivery 0.2.0-s1 --output /tmp/cve-feature-0.2.0-s1
npx @devcontainers/cli features package /tmp/cve-feature-0.2.0-s1 \
  --output-folder /tmp/cve-package-0.2.0-s1
```

Use `0.2.0-s2` and fresh output directories for the other checker state.

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

## Fixture accounting

Compare the PR base `4cf3a9f52808f698f9ec80741f0e768faa895ef0` with the
current tree. Counts below include all tracked files under the named paths;
bytes are uncompressed file-content bytes, not filesystem allocation or archive
sizes. This measures the replay/evidence slice, not the entire repository.

| Inventory | Before files / bytes | After files / bytes | Maintenance |
| --- | ---: | ---: | --- |
| `tutorial-app/evidence/cit-294-review-history-v1/**` | 66 / 290,035 | 66 / 290,035 | Historical archive, unchanged |
| `tutorial-app/evidence/cit-294-probe-reproduction-v1/**` | 144 / 202,417 | 144 / 202,417 | Pinned inputs and committed reproductions, unchanged |
| `tutorial-app/src/stories/fixtures/rails-matlab-*.json` | 8 / 104,276 | 8 / 104,276 | Generated viewer fixtures, unchanged |
| `tutorial-app/tests/rails-probes/traces/ReplayRecord.test.pkl-expected.pcf` | 1 / 22,318 | 1 / 22,318 | Generated record baseline, unchanged |
| `test/_global/cve-2026-66066-forensics/checker-inputs/**` | 0 / 0 | 31 / 79,013 | Generated scenario copies (including manifest and `.gitattributes`) |
| `src/cve-2026-66066/shared/**` | 0 / 0 | 2 / 15,494 | Generated canonical Pkl module copies |
| **Total** | **219 / 619,046** | **252 / 713,553** | **+33 files / +94,507 bytes** |

`package-cve-questions.ts --check` compares the generated inputs and shared
modules against their sources. These copies add storage but no independently
authored answers. Input archives do contain the historical checker test modules
and their goldens: those are the subject being inspected, copied from pinned
sources, not new result definitions for this harness.

For the selected `deleted-trace` question over S1/S2, an independently maintained
result definition means an authored expectation or reference-result set that
needs a human edit when intended behavior changes. Count sets, not assertions,
JSON copies, raw observations or generated baselines:

| Authored definition set | Before | After | Source |
| --- | ---: | ---: | --- |
| Question's expected noticed range | 1 | 1 | Moved from `CheckerProbes.pkl`'s inherited `Probe.expected` to feature `questions/checker/Question.pkl`; replay now imports it |
| Consistency check's expected range | 1 | 1 | Existing `rails-probes.consistency.spec.ts` `EXPECTED`, unchanged |
| Historical baseline assertion counts | 1 | 1 | `REVISIONS.baseline`, moved with the shared loader |
| Installed S1/S2 outcome and control matrix | 0 | 1 | New `test/_global/cve-checker.sh`, outside feature and subject |
| **Total authored sets** | **3** | **4** | **+1 installed regression expectation set** |

PR bodies/reviews are historical declarations, not maintained expected answers.
The capture reads observed answers from execution and never loads the installed
regression matrix into the feature or `/case`. The shared outcome function derives
assessments; it does not add a second independently authored answer matrix.

**Viewer-fixture removal is pending CIT-337.** No viewer JSON, committed probe
output or record golden is removed by CIT-335. This slice proves installed
execution and adds generated package/scenario copies; it does not yet reduce
the duplicated replay storage.
