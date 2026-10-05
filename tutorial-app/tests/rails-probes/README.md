# Rails probes through Playwright and the tutorial reporter (CIT-307)

Question from CIT-253: would running the Rails traces *through* a Playwright
suite make them more real, and is the tutorial reporter an opportunity? This
directory is the smallest thing that answers it with a run instead of an
opinion.

```sh
cd tutorial-app
npx playwright test --config=playwright.rails-probes.config.ts
```

The `probes` project needs only `pkl` on PATH (the spec skips without it): no browser, no servers, no
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

## Integrated with the CIT-253 review-1 UX

This branch builds on CIT-253 (PR 125). The Storybook fixture
`src/stories/fixtures/rails-matlab-review-1.solved.json` is no longer only
hand-written: the assertion counts in each probe's diagnostic and a labelled
**REPRODUCTION** evidence row per probe come from the executed run
(`tests/rails-probes/fixture.ts`; the rest stays authored). The reviewers' own
"not retained" row is kept beside it. The exact bytes each row points at are
committed under `evidence/cit-294-probe-reproduction-v1/reproduction/`.

* `probes` project: runs the checker, compiles the lessons, and **fails if the
  committed reproduction or fixture differs from what the checker just did**
  (`CIT307_UPDATE=1` rewrites them).
* `editor` project (depends on `probes`; needs a browser and starts
  `server.cjs` on ports 4383/4384): solves, presses Tab for each probe, opens the
  lenses, checks the marker message and evidence rows carry the executed
  numbers, and checks the Agent only diagnoses after an accept.

Two UX findings from writing it: the open evidence widget covers the next
line's lens (click the same lens again to close it), and clicking a lens takes
focus out of the editor, so the second suggestion is not offered until the
editor is focused again. The test accepts both probes before opening evidence.

## Not done here

* **Opening the retained bytes from a row.** The rows name the committed
  files, but the Client widget only shows the row text; making a row open the
  artifact is the evidence-inspector work in PR 125. The reporter lessons here
  show files only, and Storybook does not yet read them in place of the fixture.
* **Jev.** `jev-playwright` scoring and the `jevReportTrace.ts` →
  `generate-jev-lessons.mjs` route are a separate generation path from the
  reporter; joining them needs an explicit adapter. Not attempted.
* **PR 118 and 120 lessons**, and the native Rails/libvips/strace chain itself
  (needs Docker). The observations and transcript here are the retained ones,
  not re-captured.
