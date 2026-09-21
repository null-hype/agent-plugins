# Follower Maze lesson farm (CIT-203, first non-BountyBench transfer for CIT-202)

Proposition: `followerMaze.orderedRouting` -- events take effect in *sequence*
order, so the deliveries a client receives are fixed by the events, not by the
order they arrived. World: connected `{10, 20}`, events `1|F|10|20`,
`2|S|20`, `3|U|10|20`, `4|S|20`; required trace `20 <- seq 1`, `10 <- seq 2`.
Provenance: Follower Maze spec as summarised in the CIT-202 Deep Research doc.

| File | Role |
| -- | -- |
| `followerMaze.ts` | The proposition (`check`), two candidate witnesses (`arrival-order`, `reorder-buffer`), the registry function |
| `FollowerMaze.pkl` | The same proposition in Pkl, no canonical solution in it |
| `FollowerMazeFamily.pkl` | Evaluates the Pkl `check` over every arrival fixture for witnesses passed in (`-p witnesses=...`) |
| `fixtures/world.json`, `fixtures/arrivals/*.json` | Base world + the 24 arrival orderings |
| `fixtures/permutations.<model>.jsonl` | The warm-log document for each witness model; `followerMaze.spec.ts` fails if it drifts from the code (`UPDATE_FIXTURES=1` rewrites) |
| `followermaze-permutations.py` | The attached stdlib script, unmodified; the spec runs it and compares its table |
| `followerMazeLog.ts` | Turns cases into warm-log records; `LessonState` + reducer (solve / evaluate / transform) |
| `FollowerMazeStatus.tsx` | Axiom badge + counter footer: board state derived from the records, draws no diagnostic |
| `FollowerMazeBoardState.tsx` | CIT-226: the 6x4 outcome grid and the repair row. Board state and available actions only: no `fm-*` code, no message |

## Decisions recorded

* **One rendering surface.** Squiggle, hover, CodeLens and evidence widget all come from
  `templates/otel-warm-log/server.cjs` (one CIT-226 change, below). Frames 1-4 are warm-log documents too
  (the wire format is already a line stream; "green rules out nothing" is a Warning marker on
  the line under the baseline verdict). The extra UI is board state only: counts and the axiom id
  (status strip), the outcome grid, and the repair row -- never a diagnostic.
* **No frame prop.** Storyboard steps are `play()` steps clicking solve / evaluate / transform.
* **Repair row has no native slot** in the warm-log IR. The three evidence roles are exactly the
  three things a repair can change (fact = world, observation = model, axiom = axiom), so each
  related entry names its repair. A real Code Action would need a change to `server.cjs`; not done.
  CIT-226 separates what can be done from what is only a suggestion: *change model* is a button in
  the repair row (`FollowerMazeBoardState.tsx`) that swaps the witness and reruns the same family in
  place; *change world* and *change axiom* are conceptual and shown as text, marked "not available here".
* **`orderedRouting` copy**: every diagnostic's axiom evidence says ordering errors surface as
  routing errors because follow-state is temporal.
* **Pkl/TS duplication**: both exist; the 24-ordering family (plus hand-built witnesses for the two
  codes the family can't reach) is the differential test, run in `followerMaze.spec.ts`.
* **No `witness` EvidenceRole**: `fact`/`observation`/`axiom` were enough, as the Deep Research doc predicted.
* **Sorted witnesses**: both witness models present per-client traces sorted by (user, seq), as the
  reference script does (`return sorted(out)` in its `run()` -- so this is the reference convention, not a deviation). `1423` would additionally raise `fm-out-of-order` (10 receives seq 4 before
  seq 2) if emission order were preserved -- the table in CIT-203 only holds for sorted traces.

## CIT-226: UX review of the log implementation

| Review item | Change |
| -- | -- |
| High: no expected-vs-actual in a failing world | Each failing row's evidence widget gets a paired table (`pairedRows`): required delivery on the left, witness delivery on the right, the missing one holding its slot as `- - missing - -`, a forbidden one mirrored as `- - not due - -`. Text in the widget's own rows: no new field on `EvidenceLocation`. Kept to one line per pair (the widget is 600px) -- checked in the browser, not assumed |
| High: baseline warning hidden | The warning is its own log line under the PASS ("This ordering passes, but this model fails 20 of the other 23. Test all 24 orderings."), derived from the family. Its CodeLens now reads `⚠ passes here, fails 20 of the other 23`, not `✗ lesson-baseline-nondiscriminating` |
| Medium: four outcomes indistinguishable | Every evaluated row ends `-> pass|missing|forbidden|both`, lens titles say it in words (a "both" row reads `both: missing 10 <- seq 2, forbidden 10 <- seq 4`, no longer filed under its first code), and a 6x4 grid of chips spells out each outcome |
| Medium: repair ends in text | Witness-model selector in the workbench; the repair row's *change model* button reruns the family in place (`4231`: missing -> pass, footer `24 pass`) |

Why the grid and repair row are components and not warm-log lines: they show board state (which
orderings are in which outcome, what the learner can do next) and the log has no native slot for
either. They carry no `fm-*` code and no diagnostic message -- every diagnostic is still drawn by the
warm log. Why `pairedRows` is not a component: it *is* diagnostic evidence, so it lives in the
widget.

## Seam test

Permitted: one `AxiomId` member, one `worldRef()` branch, one registry entry -- **done, and that is all
`axioms.ts` / `toHaveVerdict.ts` gained** (plus the import each needs). Those three edits are
the only change to `src/lib` logic. **Result: FAIL as a strict count**, with two further outside changes:

1. `src/lib/lessonVendoring.spec.ts`: chapter-3/lesson-5 vendors `axioms.ts` and `toHaveVerdict.ts`
   byte-for-byte into a WebContainer with no `lesson-farms/` dir, so the guard now strips the follower-maze
   registration from src/lib's copy before comparing (lesson 5 stays pinned to the old registry).
   The closed `AxiomId` union is vendored elsewhere -- a real cost of "one union member".
2. `src/stories/FollowerMaze.stories.tsx`: Storybook only globs `src/stories/`.

CIT-226 adds one more outside change, to a file CIT-203 left untouched:

3. `src/templates/otel-warm-log/server.cjs`, the CodeLens title only (3 lines). The prefix now follows
   severity (`⚠` for a warning, `✗` otherwise) and an optional `diagnostic.lensTitle` replaces the
   technical code. Records without a `lensTitle` and with `severity: 'error'` render byte-for-byte as
   before; `ReasonLogDiagnostics` and `PreMergeDisagreementEvidence` still pass unmodified. This is a
   fix to the generic renderer (any warning-severity record got a `✗`), not lesson-specific code.
   `server.cjs` is not vendored by `lessonVendoring.spec.ts`.

Still untouched: `governanceDiagnostic.ts`, `EvidenceRole`, `OtelWarmLogPreview.tsx`, the Storybook config.
No new diagnostic-rendering surface: the additions are board state (grid, repair row) and text inside
the existing evidence rows.
