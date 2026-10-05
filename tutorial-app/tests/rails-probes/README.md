# Rails probes through Playwright and the tutorial reporter (CIT-307)

Question from CIT-253: would running the Rails traces *through* a Playwright
suite make them more real, and is the tutorial reporter an opportunity? This
directory is the smallest thing that answers it with a run instead of an
opinion.

```sh
cd tutorial-app
npx playwright test --config=playwright.rails-probes.config.ts
```

Needs `pkl` on PATH (the spec skips without it). No browser, no servers, no
Docker, no credentials. Lessons are compiled to `../test-results/rails-probes/tutorial`,
not into `src/content/tutorial`: promoting them into the course is a product
decision this change does not make.

## What runs for real

The pinned PR 117 checker (`cit294.test.pkl`, `Reconcile.pkl`, `Claims.pkl`,
`Observation.pkl`, the four retained observation JSONs and the expected
examples) is executed with `pkl test`, once as retained and once per probe in a
fresh temp copy:

| Step | Mutation | Result |
| --- | --- | --- |
| Baseline | none | 12 tests, 28 asserts pass |
| Delete the retained trace | `canary-reads.txt` removed | 28 asserts still pass |
| Forge a read | dummy-file `openat` added to the `mat-blocked` arm | 28 asserts still pass |

That reproduces review 1's first finding with an executed checker instead of a
quoted sentence. A third test proves the harness can fail: flipping an observed
field the checker *does* read (`block_untrusted_env`) makes the suite fail.

The spec **asserts the flaw**, so a passing test means "the checker did not
notice". The reporter writes nothing for a failed test, so this is also what
lets the lessons exist. When the checker is fixed (review 1 finding 1), this
spec goes red on the probe step: that is the intended signal, and the assertions
then flip.

## Provenance

* This is a **new reproduction** (`cit-294-117-probes-reproduction-v1`), not the
  reviewers' output. The history bundle records that their mutation outputs
  were not retained; nothing here is written into that bundle.
* The checker is S1 (`20aafd26`). `cit-294-review-history-v1` bundles only the
  files an evidence reference points at, so it cannot run the suite alone:
  `Claims.pkl`, `Observation.pkl` and `cit294.test.pkl-expected.pcf` are missing
  (without the expected file `pkl test` *writes* examples and exits cleanly, so
  the runner refuses that). They are supplied by
  `evidence/cit-294-probe-reproduction-v1/` from `390a787`, which has the same
  `cit-294/` tree as `20aafd26`. Every input is hash-checked before running.

## Findings about the reporter and the existing machinery

1. **Compiles, and is deterministic.** Two consecutive runs produce a
   byte-identical lesson tree.
2. **Continuity is real, and it caught a mistake of mine.** `before/` files
   declared for step 1 do not carry into its end state; the untouched
   `canary-reads.txt` had to be restated as a `file/` attachment or step 2
   failed to compile. Worth a line in `reporters/README.md`.
3. **Probes must write to their own paths.** State is cumulative, so each probe
   adds `probes/<name>/…` instead of editing a shared file.
4. **A deletion cannot be expressed.** The reporter's end state only grows, so
   the "deleted trace" lesson still shows `canary-reads.txt` and records the
   deletion in `probes/deleted-trace/mutation.txt`. A lesson that should *show*
   the file gone needs reporter support (an explicit tombstone attachment).
5. **Expected failure is fine.** An asserted "the checker does not notice" is a
   passing test, so the reporter emits lessons.

## Not done here

* **The editor interaction (Tab to accept a probe, open its retained bytes).**
  The review-1 ghost-text flow and `cit294-review-v1` scenario live on PR 125,
  not main. Driving it, and having Storybook read the generated lesson state in
  place of the hand-written `rails-matlab-review-1.*.json`, is the follow-up
  once PR 125 merges. These lessons only show files.
* **Jev.** `jev-playwright` scoring and the `jevReportTrace.ts` →
  `generate-jev-lessons.mjs` route are a separate generation path from the
  reporter; joining them needs an explicit adapter. Not attempted.
* **PR 118 and 120 lessons**, and the native Rails/libvips/strace chain itself
  (needs Docker). The observations and transcript here are the retained ones,
  not re-captured.
