# Recorded-run debugger interaction specification (CIT-299)

**Starting revision:** `be95c86ea1fddd8913cab7577f2405c1a2e90205` (the actual `work` branch HEAD inspected for this specification).

This slice reuses the captured Follower Maze run `ghost-trace-v1`, arrival case `4,2,3,1`, and its missing-delivery then repaired-delivery exchange. It does not add lesson prose or a new scenario. “Continue”, “step”, “select”, “open”, and “reset” below are viewer navigation; none is rendered as an agent/client protocol action.

## Stable identities

| Kind | Identity |
| --- | --- |
| recording / run | `ghost-trace-v1` / `arrival-4231` |
| frames in logical order | `request` (0), `failure` (1), `repair-request` (2), `repair-pass` (3) |
| breakpoints | `before-failure` → `request`; `failure-result` → `failure`; `repair-result` → `repair-pass` |
| failure evaluation | `followerMaze.orderedRouting:arrival-4231:arrival-order` |
| repair evaluation | `followerMaze.orderedRouting:arrival-4231:reorder-buffer` |

The existing capture happens to contain a wall-clock value, but replay ordering uses `order`; recordings without a clock remain valid. The model-specific suffixes above make two verdicts over the same axiom and case distinct (the old capture repeats one `evaluationId`; ingestion must map each recorded occurrence to the stable evaluation identity above without rewriting the captured bytes).

## Transition table

Selection and log viewport never move the playback cursor. “Persists” means inherited from the prefix, not copied into a second state store.

| Step | Viewer action | Cursor / selection | Appears | Persists | Explicitly disappears |
| --- | --- | --- | --- | --- | --- |
| 1 | Open request deep link | `request` / frame `request` | request text and state before evaluation; `before-failure` | request; viewport anchor | failure, its evidence, repair request/pass |
| 2 | Continue to disagreement | `failure` / frame `request` | missing-delivery diagnostic summary | request and its state; request selection and viewport | repair request/pass |
| 3 | Select diagnostic | `failure` / failure evaluation | evaluation ID and related-evidence list | identical cursor, request, diagnostic, viewport | nothing; selection must not advance playback |
| 4 | Open rule, then observation | `failure` / chosen evidence | exact artifact identity/location and resolved bytes | prefix and diagnostic | nothing; a missing/mismatched artifact shows its explicit error instead |
| 5 | Step back | `request` / no selection | before-failure state | request and still-valid state; viewport is independent | failure, diagnostic/evidence, and now-invalid selection; all repair state |
| 6 | Step forward | `failure` / failure evaluation | byte-for-byte same diagnostic/evidence identities and derived view as steps 2–4 | request and viewport | repair request/pass |
| 7 | Continue to repair result | `repair-pass` / repair evaluation | repair request and PASS evaluation | request, earlier failure and its inspectable evidence | nothing from the recorded prefix |
| 8 | Reset, then preview reload; repeat 1–7 | first `request`, finally `repair-pass` / same selections | the same snapshots and identities in the same logical order | recording/run identity | reset removes post-request state; reload adds no state and substitutes no run |

## Artifact identities

The governing rule is `tutorial-app/evidence/ghost-trace-v1/followerMaze.ts` at revision `be95c86ea1fddd8913cab7577f2405c1a2e90205`, source range `279–334`. The captured observations are records 6 (failure) and 8 (repair) of `tutorial-app/evidence/ghost-trace-v1/wire-transcript.jsonl` at capture identity `ghost-trace-v1`, at structured locations `result._meta.diagnostic.related[1]`. The request/case is `tutorial-app/evidence/ghost-trace-v1/arrival-4231.json` at the same capture identity, whole record 1.

An artifact resolver receives only an `ArtifactRef` and returns bytes or an explicit `artifact-not-found` / `artifact-identity-mismatch` result. It does not know or mutate the cursor. This is the handoff boundary for CIT-253.

## Contract and handoff

`acpReplayContract.ts` is the shared state model. A snapshot is solely the ordered prefix ending at the cursor. Evaluations and evidence become available only when their frame is in that prefix. A selection outside the prefix is intentionally cleared with `selection-not-in-prefix`; a bad recording/run/frame deep link returns an error and never falls back to the newest run. Selection and `LogViewport` remain independent coordinates.

Recorded/scripted/simulated input provenance is mandatory and distinct from verdict channels. Test outcome, diagnostic code, model judgement, and authority therefore cannot silently become one “pass” value. `SuppliedArtifactResolver` is deliberately separate from replay derivation.

Already passing: typed prefix derivation tests cover inherited state, future exclusion, intentional removal, deterministic forward replay, and invalid frame links. Implementation targets: the playback controls, evidence resolver/UI, deep-link surface, and the Storybook observable sequence in `tests/recorded-run-debugger.acceptance.spec.ts`. The latter is kept in an explicit opt-in development harness until those targets land; its assertions are not weakened or replaced with component-internal checks.

Run the current checks with `npm test -- --run src/lib/acpReplayContract.spec.ts`. Run the future acceptance sequence with `DEBUGGER_ACCEPTANCE=1 npx playwright test --config=playwright.debugger.config.ts`.
