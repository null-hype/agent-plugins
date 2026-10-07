# Replay records (CIT-334)

`src/jev/pkl/Question.pkl` gains a case-independent record of one Question
asked of successive workspace states. The existing `Question` supplies the
collector, judge, required evidence and expectation. The existing `outcome`
function does the assessment. The rails probes' `deleted-trace` Question is the
first one recorded, at both checker revisions (S1 = PR 117, S2 = PR 118).

| File | Role |
| --- | --- |
| `src/jev/pkl/Question.pkl` | The shared types: `Evidence`, `WorkspaceState`, `Mutation`, `Transition`, `Delivery`, `Declaration`, `EvaluationRecord`, `Investigation`, and `validRecord` / `validInvestigation`. |
| `src/jev/pkl/EvaluationRecord.test.pkl` | Facts about the schema, checked on synthetic states with no Rails or PR fields. |
| `records.ts` | Builds the capture from committed evidence, through `probes.ts`'s `pinnedInputs`. |
| `traces/ReplayRecord.pkl` | Types the capture as a `Question.Investigation`. A capture that does not validate does not evaluate. |
| `traces/ReplayRecord.test.pkl` (+ `-expected.pcf`) | Facts about these two revisions. Its examples are the generated records, committed as the baseline. |

## What it reuses from Vaults

`.dagger/internal/devenv-base/pkl/Vaults.pkl` and `Vaults.test.pkl` split
their check four ways. The record follows the same split:

| Vaults | Replay record |
| --- | --- |
| **Declared.** `Vaults.pkl`'s `declared` | Each record's `declarations` hold the PR's own claim, quoted from its retained body (e.g. "8 facts / 28 asserts"), with the value it declares. |
| **Observed.** `capture-vault-inventory.sh` writes `build/vaults-observed.json` | `records.ts` writes the capture. Each declaration's `observed` value is read from the reproduced baseline run. |
| **Checked.** `Vaults.test.pkl`'s `facts` | `validRecord` / `validInvestigation`, and `ReplayRecord.test.pkl`'s facts. One of those facts is "declared == observed", like Vaults' "declared item exists". |
| **Baseline.** `examples` + `Vaults.test.pkl-expected.pcf` | `examples { ["generated records"] }` + `ReplayRecord.test.pkl-expected.pcf`. A changed capture is a reviewable diff, not a silent pass. |

What Vaults has no need for, and the record adds:

- **Immutable source IDs.**
  - A state's source is a `git-commit:` id.
  - Each pinned input is its `git-blob:` id.
  - Each capture or reproduced file is a `sha256:` hash, checked against the history manifest where one exists.
  - In Vaults, an observed vault is just a name.
- **Historical vs reproduced origin.**
  - The PR bodies, reviews and pinned inputs are `historical`.
  - The probe's `answer.json`, `result.txt`, `mutation.txt` and the baseline run are `reproduced`.
  - Origin is descriptive in the shared schema. Any retained resource, original or reproduced, can substantiate an answer or an observed value; a missing one never can, and never carries an id.
  - This case's expectations are its adapter's facts (`ReplayRecord.test.pkl`): each declaration cites the PR's historical body, each observed value and each answer a retained reproduction.
- **Missing evidence as a value.** Each of these is a `missing` resource with a reason, and can never carry an id:
  - the reviewer's own deleted-trace output,
  - the image digest,
  - the container snapshot.

  In Vaults, absence is only a failing fact (`observedVault(...) != null`).
- **A disagreement is data.** In the schema, `declared != observed` is a valid record. Only this investigation's test asserts that the two agree, as Vaults' facts do.

## Probe mutation vs investigation transition

- **`Mutation`** is the probe, *inside* one checker revision.
  - It removes `canary-reads.txt` from a copy of that revision's pinned inputs.
  - It can only name inputs of its own state (`affects`).
  - The record's `state` stays the pinned state.
- **`Transition`** is the investigation moving *between* revisions: S1 → S2.
  - It is prompted by `review-1.finding-1`.
  - Its evidence is the retained review-1 comment and PR 118's body.
  - It must link consecutive records' states and change their source commit.
  - Its `finding` must be the delivery finding of the record it leaves.
  - No two records may share a state id, so `from`/`to` are unambiguous.

PR 154's first version had a single `before`/`after` + `transition`. That was the probe, so the two were conflated.

## Pinned inputs: one loader

`capture-records.py` is removed. It re-implemented `probes.ts`'s verification
and checked supplements with `git rev-parse`, but the Dagger check ignores
`.git`. `probes.ts` now exports `pinnedInputs(key)`:

- It does the same manifest sha256/blob-id checks, and the same supplement blob-id checks, with the same errors.
- It returns each input's committed file and ids.
- `loadPinnedChecker` is `pinnedInputs` as a `Map`, so the probes, collectors and lessons are unchanged.

## In the check pipeline

`rails-probes.consistency.spec.ts` is the `rails-probes:consistency` project
that `dagger call rails-probes check` (`.github/workflows/investigations.yml`)
already runs. It now adds these rules, and `Consistency.pkl` decides as before:

| Rule | Holds when |
| --- | --- |
| `record-schema` | `Question.test.pkl` and `EvaluationRecord.test.pkl` pass. Neither ran in CI before. |
| `record-baseline` | `ReplayRecord.test.pkl` passes against its committed `-expected.pcf`. Writing examples instead of comparing them does not count. |
| `record-valid` | The capture evaluates as a record. |
| `record-scope` | The generated records are exactly the revisions `records.ts` names in `RECORDED` (S1, S2), in order. |
| `record-rejects-tampered` | A capture whose missing observation was given an invented id does **not** evaluate. |
| `record-agrees`, on `s1-deleted-trace` / `s2-deleted-trace` only | The generated record's answer equals the checker re-run on the recorded mutation, its Pkl `outcome` matches the spec's `noticed()`, and its observed baseline count equals the re-run baseline. A missing record for S1 or S2 breaks the rule; S3 and S4 have no record in this slice and keep every other rule. |

To rewrite the baseline after an intended change, run:

```sh
CIT307_UPDATE=1 npx playwright test --config=playwright.questions.config.ts --project rails-probes:consistency
```

To check the schema alone, run from the repository root:

```sh
pkl test src/jev/pkl/Question.test.pkl src/jev/pkl/EvaluationRecord.test.pkl
```

## Delivery

Each record carries a `planned` delivery:

- **Feature:** `cve-2026-66066`
- **Scenario:** `test/_global/cve-2026-66066-forensics`
- **Finding:** the revision's own finding

`version` is null. Each review round is its own `YYYYMMDD.HHMM` version, and
`validInvestigation` rejects two rounds that share one. Neither version exists
yet: packaging them is CIT-335. A `captured` delivery needs a version and
retained evidence that it was installed.

## Scope

- **Not new container runs.** These records adapt retained reproductions.
- **Capture scope.** Only the checker inputs are captured, not the application or the container.
- **Forecasts.** The record has a probability `forecast` slot, distinct from the answer. The feature's forecast tree is on the unmerged CIT-330 branch, so neither record forecasts.
- **Viewer consumption.** That is CIT-337.
