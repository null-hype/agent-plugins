# Rails probes through Playwright and the tutorial reporter (CIT-307, CIT-309)

Question from CIT-253: would running the Rails traces *through* a Playwright
suite make them more real, and is the tutorial reporter an opportunity? This
directory is the smallest thing that answers it with a run instead of an
opinion.

```sh
cd tutorial-app
npx playwright test --config=playwright.questions.config.ts --project 'rails-probes/*' --project rails-probes:lesson
```

CIT-317: the two probes are Questions in `traces/CheckerProbes.pkl`
(`questions`). `playwright.questions.config.ts` makes each one a project
(`rails-probes/deleted-trace`, `rails-probes/forged-read`) that runs the generic
`tests/questions/question.spec.ts` with the collector the Question names
(`collectors.ts`). A project fails only when its answer could not be collected;
"the checker did not notice" is recorded as an out-of-range outcome, and the
`rails-probes:lesson` project, which depends on both, still compiles it.

The Question and lesson projects need only `pkl` on PATH (the config reads the
Questions with it): no browser, no Docker, no credentials. The `@tutorial` test compiles the lesson into
`src/content/tutorial/part-4/can-the-checker-be-trusted` (the chapter
directory is rewritten on every run; the chapter is listed in part 4's `meta.md`).
Commit what it produces.

## One spec, the revision as input (CIT-309)

The two questions are asked of each checker state in turn, with the same
mutations and the same wording; `REVISIONS` in `probes.ts` is the input
(S1 = PR 117, S2 = PR 118). Each state is one lesson of the chapter
`can-the-checker-be-trusted`, so the second lesson is held by the reporter's
continuity check to what the first left behind.

| Revision | Baseline | Delete the trace | Forge a read |
| --- | --- | --- | --- |
| S1, PR 117 (`20aafd26`) | 12 tests, 28 asserts pass | still 28 | still 28 |
| S2, PR 118 (`8d097c8e`) | 22 tests, 56 asserts pass | still 56 | still 56 |

PR 118's description says deleting the trace or forging a read "is now flagged".
Review 2 says it is not, because the new negative controls change the derived
open count rather than the retained trace. The S2 run agrees with review 2. The
run does not say whether the claim is *wrong* in some other reading, only that
these two mutations of the retained trace pass.

## What runs for real

The pinned checker of each revision (`cit294.test.pkl`, `Reconcile.pkl`,
`Claims.pkl`, `Observation.pkl`, the retained observation JSONs and the expected
examples) is executed with `pkl test`, once as retained and once per probe in a
fresh temp copy. Both revisions get the same steps:

| Step | Mutation | S1, PR 117 | S2, PR 118 |
| --- | --- | --- | --- |
| Baseline | none | 12 tests, 28 asserts pass | 22 tests, 56 asserts pass |
| Delete the retained trace | `canary-reads.txt` removed | 28 still pass | 56 still pass |
| Forge a read | dummy-file `openat` added to the `mat-blocked` arm | 28 still pass | 56 still pass |

At S1 that reproduces review 1's first finding with an executed checker instead
of a quoted sentence; at S2 it agrees with review 2. A further test per revision
proves the harness can fail: flipping an observed field the checker *does* read
(`block_untrusted_env`) makes the suite fail.

The spec **records the answer** (CIT-311). For each probe it writes down the
exit code and the assertion counts and does not assert them, so "the checker
still passes" and "the checker now fails" are both data and both produce a
lesson (the lesson prose and the diagnostic say which). A failed test means
only that the answer could not be collected: an input does not hash, the
retained checker does not pass as retained, a mutation does not apply, or
`pkl test` exits cleanly without a readable summary. A checker that exits
non-zero before it prints any summary counts as having noticed the probe, with
no assertion counts. The annotations on the test report each answer.

The `block_untrusted_env` test is the control: it shows the harness can see a
difference when there is one, and that a "noticed" answer is written into the
fixture as data. The inputs are pinned by blob id, so a fix to the checker
cannot change these runs; only adding a revision can. If its checker catches a
probe, the reproduction files for it do not exist yet, so the drift check names
them until `CIT307_UPDATE=1` writes them.

## Consistency: watching the watchmen (CIT-320)

The `rails-probes:consistency` project (`rails-probes.consistency.spec.ts`) trusts none of
the probes' records. For each state it re-runs the pinned checker on each
**recorded** mutation and requires the recorded answer, checks the recorded
forged transcript differs from the pinned one by exactly the forged line, that
the baseline passes as declared, that the `block_untrusted_env` control is
noticed (a blind checker makes every "not noticed" meaningless), that a "not
noticed" answer ran the baseline's full assertion count, and that the lesson
and its solved trace say what the record says. `src/jev/pkl/Consistency.pkl`
decides; a probe the checker does not notice is an `out-of-range` row, not a
failure.

```sh
RAILS_PROBES_NO_SERVERS=1 npx playwright test --config=playwright.questions.config.ts --project rails-probes:consistency --project rails-probes:lesson
```

The probes' summary parsing needs Pkl 0.32 (the committed reproduction's
version). In CI, the root Dagger module's `rails-probes check` runs the
consistency pass on the committed records, then the probes
(`.github/workflows/investigations.yml`).

## Provenance

* This is a **new reproduction** (`cit-294-checker-probes-reproduction-v1`, named for the questions, not for
  either review), not the reviewers' output. The history bundle records that their mutation outputs
  were not retained; nothing here is written into that bundle.
* The S1 checker is `20aafd26` (S2 is `8d097c8e`). `cit-294-review-history-v1` bundles only the
  files an evidence reference points at, so it cannot run the suite alone:
  `Claims.pkl`, `Observation.pkl` and `cit294.test.pkl-expected.pcf` are missing
  for S1, and `Claims.pkl` and the expected file for S2 (without the expected file `pkl test` *writes* examples and exits cleanly, so
  the runner refuses that). They are supplied by
  `evidence/cit-294-probe-reproduction-v1/` from `390a787` (S1) and `9739b539` (S2), which have
  the same `cit-294/` trees as `20aafd26` and `8d097c8e`. Every input is hash-checked before running.

## The generated lesson

One `@tutorial` test, one step per revision, one lesson per step. Lesson 1:
**Can the check tell a real file read
from a forged one?** Its `_files/acp-trace.json` is the starter trace and its
`_solution/acp-trace.json` is the solved fixture (executed numbers included), so
TutorialKit's own Solve plays the Storybook flow in the Client and Agent
previews. Solve also reveals the reproduction files (`_solution/reproduction/…`).
`AcpTraceBridge` now relays the Client's acceptance to the Agent pane, so the
Agent shows "Deciding what to check…" until a suggestion is accepted, as in
Storybook.

The `playback` project plays the generated lesson in the real TutorialKit dev
server (WebContainer previews; needs network for `npm install`): the Agent is
still deciding after Solve and diagnoses after Tab. Roughly 15 s once booted.

## The lessons' traces are authored in Pkl (CIT-312)

The S1 and S2 starter and solved traces are rendered from
`traces/CheckerProbes.pkl` (shape in `traces/AcpTrace.pkl`) instead of being
patched into a hand-written fixture. The module holds what is claimed: the
questions, the ids, the review's own words and the trace structure, with the
state, checker commit and reproduction id passed in. It declares nothing
measured. Each probe's exit code and counts are read from the `answer.json`
the runner writes beside its `result.txt`, so the module cannot render without
a run to read: a missing answer is a Pkl error, not a default.

The spec renders from the answers of the run it just made, and the same
rendered bytes become the Storybook fixture and the lesson's `acp-trace.json`.
Both fixtures stay committed under the drift check. The `answer.json` files are
committed beside the reproduction but are not copied into the lesson. The
`block_untrusted_env` control renders a "noticed" answer through the module
too.

Each state's first render was byte-identical to the fixture it replaces (S1
first, then S2 as one more entry in `revisions`). With both states in the
module, the old path that patched a run into a hand-written fixture
(`applyReproduction`) is gone. A new revision is one more entry.

## Ids follow the review history (CIT-313)

An id that names something a reviewer said is the recorded history's id,
verbatim (`src/lib/reviewHistory/declarations.ts`): S1's probes test
`review-1.finding-1`, S2's test `review-2.gap-1`. Each revision in
`CheckerProbes.pkl` declares its `findingId`. Evaluation ids are spelled as the
history spells them (`cit-294-117-118-120:<finding id>`), and a probe's code is
the finding id plus the question (`review-2.gap-1.deleted-trace`). The spec
fails if a finding id is not in the history or its message differs from the
history's. An id for something made here (a run, a probe, a reproduction) is
named for the question, and the checker state is a field, never part of the id.

## Findings about the reporter and the existing machinery

1. **Compiles, and is deterministic.** Two consecutive runs produce a
   byte-identical lesson tree. The earlier three-step file lessons were folded
   into this single lesson; the probes now run inside its one step.
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
5. **A failed test writes nothing, so a "no" cannot be a failure.** The reporter
   emits lessons only for passing tests. The spec used to assert "the checker
   does not notice", which made a fixed checker the one answer that wrote no
   lesson. It now records the answer either way and fails only when it cannot
   collect one (CIT-311).

## Integrated with the CIT-253 review-1 UX

This branch builds on CIT-253 (PR 125). The Storybook fixture
`src/stories/fixtures/rails-matlab-review-1.solved.json` is no longer
hand-written: the assertion counts in each probe's diagnostic and a labelled
**REPRODUCTION** evidence row per probe come from the executed run, and the
rest is authored in `traces/CheckerProbes.pkl` (see above). The reviewers' own
"not retained" row is kept beside it. The exact bytes each row points at are
committed under `evidence/cit-294-probe-reproduction-v1/reproduction/<S1|S2>/`.

* `rails-probes/<question>` projects run the checker; the `rails-probes:lesson`
  project compiles the lessons from that run, and **fails if the
  committed reproduction or fixture differs from what the checker just did**
  (`CIT307_UPDATE=1` rewrites them).
* `editor` project (`rails-probes:editor`, depends on the lesson; needs a browser and starts
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
* **Jev.** The part-5 lessons now come from the reporter too (CIT-318,
  `tests/jev/jev.tutorial.spec.ts`, project `jev:lesson`).
* **PR 118 and 120 lessons**, and the native Rails/libvips/strace chain itself
  (needs Docker). The observations and transcript here are the retained ones,
  not re-captured.
