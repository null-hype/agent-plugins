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

## Decisions recorded

* **One rendering surface.** Squiggle, hover, CodeLens and evidence widget all come from
  `templates/otel-warm-log/server.cjs`, unmodified. Frames 1-4 are warm-log documents too
  (the wire format is already a line stream; "green rules out nothing" is a Warning marker on
  the baseline verdict line). The status strip is the only extra UI and shows counts and the
  axiom id, never a diagnostic.
* **No frame prop.** Storyboard steps are `play()` steps clicking solve / evaluate / transform.
* **Repair row has no native slot** in the warm-log IR. The three evidence roles are exactly the
  three things a repair can change (fact = world, observation = model, axiom = axiom), so each
  related entry ends in `(change world|model|axiom)`. A real Code Action would need a change to
  `server.cjs`; not done.
* **`orderedRouting` copy**: every diagnostic's axiom evidence says ordering errors surface as
  routing errors because follow-state is temporal.
* **Pkl/TS duplication**: both exist; the 24-ordering family (plus hand-built witnesses for the two
  codes the family can't reach) is the differential test, run in `followerMaze.spec.ts`.
* **No `witness` EvidenceRole**: `fact`/`observation`/`axiom` were enough, as the Deep Research doc predicted.
* **Sorted witnesses**: both witness models present per-client traces sorted by (user, seq), as the
  reference script does (`return sorted(out)` in its `run()` -- so this is the reference convention, not a deviation). `1423` would additionally raise `fm-out-of-order` (10 receives seq 4 before
  seq 2) if emission order were preserved -- the table in CIT-203 only holds for sorted traces.

## Seam test

Permitted: one `AxiomId` member, one `worldRef()` branch, one registry entry -- **done, and that is all
`axioms.ts` / `toHaveVerdict.ts` gained** (plus the import each needs). Those three edits are
the only change to `src/lib` logic. **Result: FAIL as a strict count**, with two further outside changes:

1. `src/lib/lessonVendoring.spec.ts`: chapter-3/lesson-5 vendors `axioms.ts` and `toHaveVerdict.ts`
   byte-for-byte into a WebContainer with no `lesson-farms/` dir, so the guard now strips the follower-maze
   registration from src/lib's copy before comparing (lesson 5 stays pinned to the old registry).
   The closed `AxiomId` union is vendored elsewhere -- a real cost of "one union member".
2. `src/stories/FollowerMaze.stories.tsx`: Storybook only globs `src/stories/`.

Untouched: `server.cjs`, `governanceDiagnostic.ts`, `EvidenceRole`, `OtelWarmLogPreview.tsx`, the Storybook config.
No new diagnostic-rendering surface was added.
