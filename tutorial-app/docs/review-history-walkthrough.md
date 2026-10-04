# The 117 → 118 → 120 review-history walkthrough (CIT-306)

**Status: partial, and this issue stays incomplete.** This change delivers the
unblocked part of CIT-306: the recorded history as a CIT-299 recording, the
pinned evidence behind it, the finding-to-evidence map, the executable sequence
over that data, and the correction of the canary lesson. It does **not**
deliver a runnable walkthrough. The shared playback controller (CIT-300) and
the artifact resolver (CIT-253) exist only as **unreviewed draft PRs** (#126
and #125, opened while this was being built), and the shared inspector for
Storybook and TutorialKit (CIT-301) has not started. The brief forbids building
a second controller, resolver or renderer here, and nothing unmerged is
consumed. A static page and a skipped browser test are not completion; both are
reported below as exactly that.

## What is delivered

| Path | What it is |
| --- | --- |
| `tutorial-app/evidence/cit-294-review-history-v1/` | Exact bytes at the four pinned revisions (47 files), the raw commit objects, the saved review texts and the collector: 219 KB. Its `README.md` says how each part was obtained and how far to trust it. |
| `src/lib/reviewHistory/` | The recording (`reviewHistoryRecording`, a CIT-299 `ReplayRecording`: 9 frames, 15 evaluations, 153 evidence items), its identities, labels, the relations between findings, and the deferred and missing records. Data only: no controller, resolver or renderer. |
| `src/lib/reviewHistory/*.spec.ts` | `bundle.spec.ts` (bytes, ranges, quotes), `sequence.spec.ts` (state, sequence, absence, roles, labels), `lesson.spec.ts` (the corrected page). |
| `src/content/tutorial/part-4/rails-matlab-canary/…/content.mdx` | The corrected lesson (T11). |
| `tests/review-history.acceptance.spec.ts`, `playwright.review-history.config.ts` | The browser acceptance target. Opt-in and skipped by default: it needs CIT-301. |

## Who supplies what

Dependencies are not fallbacks. Each missing capability is reported against its
owner with the exact missing behaviour, and nothing here stands in for it.

| Owner | State now | Exact missing API or behaviour | What this change gives it |
| --- | --- | --- | --- |
| **CIT-299** contract (merged, `4338e85`) | Done | Gaps found while building against it: see "Contract gaps" | `reviewHistoryRecording`, valid against `validateReplayRecording` and derivable with `deriveReplaySnapshot` at every cursor |
| **CIT-300** playback | Todo. Draft PR [#126](https://github.com/null-hype/agent-plugins/pull/126), head `1a0dd75`, unreviewed and unmerged | One reviewed, merged controller owning cursor and derived state: forward, back, seek by frame or breakpoint, reset, continue-to-next-recorded-diagnostic, on `deriveReplaySnapshot`, with selection and viewport unable to move the cursor | 9 frames and 9 breakpoints, one each. Every frame after `q0` carries an evaluation, so each "continue" stops on the next frame. `sequence.spec.ts` checks the derivation any controller must reproduce. |
| **CIT-253** resolver | Todo. Draft PR [#125](https://github.com/null-hype/agent-plugins/pull/125), head `b8979a0`, unreviewed and unmerged | One reviewed, merged `SuppliedArtifactResolver` for the two identity kinds this recording uses, `revision` (a 40-hex commit, including the S1 and S2 reviewed commits that are not on main) and `capture`, with a `source-range` location and the explicit `artifact-not-found`, `artifact-identity-mismatch` and `artifact-location-mismatch` outcomes | `manifest.json` maps every `(revision, path)` to bytes with blob id and sha256, plus every capture; every range is verified against the bytes |
| **CIT-301** inspector | Backlog, blocked by CIT-300 and CIT-253, not started | A story and TutorialKit route(s) that load a recording by `recording`, `run` and `frame`, **render the pinned question for a checkpoint frame**, show evidence with **per-item labels**, keep input, monitor and diagnostic in separate regions, stay reload-safe, and offer a revision compare | The labels (`REVIEW_HISTORY_EVIDENCE_LABELS`), the step statuses and an acceptance target that drives the control names CIT-299's uses |
| **CIT-302** arm comparison | Backlog | Not a prerequisite for this slice | The four arms' observations are evidence at each state |
| **CIT-304** authoring | Backlog. Retains the deferred items (CIT-305) | Typing a new or post hoc question, grey suggestions, premise and hypothetical-commit exploration (T12 to T15) | Named in `REVIEW_HISTORY_DEFERRED`; not started and not claimed |
| **CIT-233** sealing | Todo | Prospective registration | None. A historical run cannot be registered, so there is no Register action; Q0 carries "not sealed before this run" |

## The seven acceptance steps

"Data" is what this change proves with tests. "UI" is what the brief requires
on top of it, in Storybook and TutorialKit, and which is blocked.

| # | Step | Data (tested here) | UI | Blocked on |
| --- | --- | --- | --- | --- |
| 1 | Open Q0 before its result, as historical issue text, with stable ids | Frame `q0-question`, pin `q0` carrying the issue's criteria verbatim and "not a sealed declaration"; ids `cit-294-review-history-v1` / `cit-294-117-118-120` | Not built | CIT-301 |
| 2 | Advance through #117's result to the first review; keep Q0 and the claim; a finding is review evidence | Frames `s1`, `r1`. Findings are `review`-channel evaluations with the review's own capture as provenance; none is derived from the empty `diagnostics.json` | Not built | CIT-300, CIT-301 |
| 3 | Select a finding without moving playback; open its review text and the source at the pinned revision; missing output is "not captured" | Selection leaves the cursor unchanged for every question, evaluation and evidence item at every cursor; each finding lists its review text, the cited range at the pinned revision, and a `missing` mutation output with a reason | Opening bytes and highlighting a range not built | CIT-253, CIT-301 |
| 4 | Advance through #118, the re-review, #120 and the follow-up; map each finding; keep earlier claims and findings | Four checker states, three review/fix cycles; each finding carries its answer as later-available evidence; earlier evaluations are never dropped or changed | Not built | CIT-300, CIT-301 |
| 5 | Step back and forward; direct seek agrees; navigation is not an agent action | A forward, backward, forward walk and a seeded random walk reproduce direct seeks exactly, with the recording frozen; stepping back clears a no-longer-valid selection explicitly and keeps a valid one; no frame names a navigation verb or invents a wire exchange | No controller on main | CIT-300 |
| 6 | Reset and reopen the same location; explicit outcomes for bad references | A location survives a JSON round trip to the identical snapshot; an unknown frame, a wrong recording or run, and an out-of-prefix selection each return an explicit outcome | Reload-safe link not built; "unavailable artifact" needs a resolver | CIT-301, CIT-253 |
| 7 | Exercise it through real UI in Storybook and TutorialKit, prose hidden, roles distinct | A prose-free text projection of the recording shows the question, the sequence, the disagreement and the changed conclusion at each cursor; roles are kept apart by location role, content kind and verdict channel | **Skipped**: `tests/review-history.acceptance.spec.ts` | CIT-301 |

## Checked against the draft controller and resolver

Nothing here depends on the drafts. To learn what CIT-301 will face, I merged
both draft heads onto `main` in a **throwaway worktree** (a fast-forward to #126
and a clean merge of #125; nothing committed to this branch), added this
recording, and ran a scratch spec. The three `reviewHistory` spec files (85
tests) also passed on that merged tree. This is evidence about unreviewed
drafts, not acceptance, and it is not part of this change because it needs
unmerged code.

| Check | Result |
| --- | --- |
| #126 controller: `stepForward` and `stepBack` reproduce `deriveReplaySnapshot` at every frame; `seek` agrees; stepping back from the first frame gives an empty prefix | pass |
| #126 `continueToDiagnostic` visits `q0` → `s1` → `r1` → `s2` → `r2` → `s3` → `r3` → `s4` → `landed` | pass |
| #126 `seekBreakpoint` reaches `final-follow-up`; an unknown breakpoint returns `frame-not-found`; `reset` returns to the first frame with no selection | pass |
| #126 `select` leaves the cursor unchanged; stepping back past an evidence selection clears it with `selection-not-in-prefix`, and stepping forward does not bring it back | pass |
| #125 resolver, given a bundle generated from this recording's manifest: all 139 captured references resolve to exactly the pinned bytes | pass |
| #125 resolver: the merged spelling of a reviewed commit gives `artifact-identity-mismatch`; an unknown artifact id gives `artifact-not-found`; a line past the end gives `artifact-location-mismatch` | pass |
| #126 story component rendered at each of the 9 frames: no throw, and no later frame id in the output | pass |

An eighth scratch check only asserts that the draft story's source hard-codes
the Follower Maze label strings quoted below; its passing records an
observation, not compatibility.

What the drafts do not yet handle, observed on the same run (for CIT-301 and the
owners to settle; none is a defect in this change):

- **The question is not shown.** The #126 story component writes each frame as
  its id, its `action` and the text of `params.prompt` if there is one, and
  nothing else about the frame. A checkpoint frame carries its question as a
  pin, so at `q0-question` it prints the action ("pose the original question
  and criteria (historical issue text)") and the footer "1 pins", but not the
  criteria: the scratch check confirmed the question's text is absent from the
  render.
- **Labels are Follower Maze's.** Every `source` item is headed "Governing
  rule", the item with id `arrival-order-observation` "Missing delivery
  observation", and any other item "Repair observation". Here execution output
  and review prose all read "Repair observation", and PR bodies, issue text and
  commit messages read "Governing rule", because the contract has no content
  kind for them (contract gap 7).
- **The #125 inspector lists an item by role, path and revision only**, so in
  `review-2.gap-1` six items read as `cit294.test.pkl` at `296ca9f8` and six as
  `cit294.test.xml` at that revision, and it highlights only the first line of a
  range.
- **The #125 bundle is one entry per reference with the content inline**: 779 KB
  serialized for these 139 references, against 219 KB for the same material
  stored once (47 files, 182 KB, and 16 captures, 38 KB). A host that ships the
  bundle in a browser or a TutorialKit `_files` should decide whether that is
  acceptable. It also means only the spelling of a commit the entry was written
  with resolves.

## Identities

- Recording `cit-294-review-history-v1`, run `cit-294-117-118-120`.
- Frames, in order: `q0-question`, `s1-claimed-result`, `r1-review`,
  `s2-correction`, `r2-re-review`, `s3-correction`, `r3-review`, `s4-follow-up`,
  `landed`. Breakpoints: `question-q0`, `claimed-result`, `first-review`,
  `first-correction`, `re-review`, `initial-120-correction`, `third-review`,
  `final-follow-up`, `landed`.
- A question is the frame that poses it: Q0 → `q0-question`, Q1 → `r1-review`,
  Q2 → `r2-re-review`, Q3 → `r3-review`. Q0's wording is verbatim issue text;
  Q1 to Q3 show CIT-305's one-line framing and the reviewer's own wording
  separately, because the framing is an editorial reading.
- Revisions. S1 `20aafd26…` (merged as `390a7873…`) and S2 `8d097c8e…`
  (merged as `9739b539…`) are pinned to the commits the reviews cite; the merged
  copies have equal patch ids and identical `cit-294/` and `CIT-294.md` trees.
  **S3 `296ca9f8…` and S4 `cc23e892…` have no reviewed spelling**: GitHub
  re-created them when the stack merged (committer `GitHub`, signed, in one
  03:57:18Z batch), and the commits they replaced are not recorded. S5
  `bc97c0e6…` has the same tree as S4, so what landed is exactly S4.

## Labels

Implementation status and evidence provenance are separate, in CIT-305's
vocabulary. Every step is **stubbed** today: the corrected lesson narrates it,
but nothing a reader can select, step or open exists. `sequence.spec.ts` refuses
`working` while the shared inspector is missing.

| Frame | CIT-305 row | Implementation | Evidence |
| --- | --- | --- | --- |
| `q0-question` | T1 | stubbed | recorded prose |
| `s1-claimed-result` | T2 | stubbed | captured execution · recorded prose · not available (no retained check result) |
| `r1-review` | T3 | stubbed | recorded prose · not available (mutation output) |
| `s2-correction` | T4 | stubbed | captured execution · recorded prose |
| `r2-re-review` | T5 | stubbed | recorded prose · not available (mutation output) |
| `s3-correction` | T6 | stubbed | captured execution · recorded prose |
| `r3-review` | T7 | stubbed | recorded prose, **second-hand** · not available (original text, mutation output) |
| `s4-follow-up` | T8 | stubbed | captured execution · recorded prose |
| `landed` | T9 | stubbed | captured execution |

## The finding-to-evidence map

Each finding opens at its review frame with the review's own text, the source
range the review cites at the pinned revision, and what was not captured. What
answers it is attached to the **same** evaluation but is only available from the
correction's frame, so the contract's prefix filter hides it until the cursor
gets there (74 of the 153 evidence items are of this kind). Line numbers are
`Lnn`; "JUnit" is the line of the retained `reports/cit294.test.xml` that lists
the fact as passing. The recording is the source of truth; this table is a
reading aid.

| Finding | The reviewer's words | Cited at the review | Answered from | By (source change · check fact · retained report line) |
| --- | --- | --- | --- | --- |
| `review-1.finding-1` | The independent file-read evidence never reaches the checker. | `run_arms.sh` @S1 L21–30 | `s2` | `run_arms.sh` @S2 L41–63; `Observation.pkl` L46–65; `Reconcile.pkl` L91–101 · facts L29–31 (JUnit L6), L42–44 (L9), controls L98–101 (L19), L102–105 (L20) |
| `review-1.finding-2` | A generic variant crash passes as successful blocking. | `cit294.test.pkl` @S1 L27–33 | `s2` | `Reconcile.pkl` @S2 L47–56 · facts L32–37 (L7), controls L76–81 (L15), L82–86 (L16) |
| `review-1.finding-3` | Byte recovery is trusted through a boolean. | `Reconcile.pkl` @S1 L35–39, and the arm's own self-report | `s2` | `Reconcile.pkl` @S2 L60–70, L80–90 · facts L24–28 (L5), L45–54 (L10), controls L87–93 (L17), L94–97 (L18) |
| `review-1.finding-4` | The tutorial/report acceptance step is missing. | `CIT-294.md` @S1 L249–254; no `reports/` at S1 | `s2`, in part | `diagnose.pkl`; `run_arms.sh` L75–80; `diagnostics.json` (empty); JUnit header (22 tests). No tutorial page at S2 |
| `review-2.gap-1` | The trace negative controls mutate the derived count, not the retained trace. | `cit294.test.pkl` @S2 L98–104, and the PR #118 claim | `s3` | `Observation.pkl` @S3 L54–64; `run_arms.sh` L38–72; `Reconcile.pkl` L24–31, L100–122 · facts L32–35 (L7), L49–51 (L11), relabelled controls L115–118 (L22), L119–122 (L23), new controls L123–126 (L24), L127–131 (L25) |
| `review-2.gap-2` | Input/configuration identity is recorded but incompletely checked. | `cit294.test.pkl` @S2 L55–63; `Observation.pkl` L54 | `s3` | `Claims.pkl` @S3 L48–74; `Reconcile.pkl` L123–140 · facts L67–76 (L14), L77–80 (L15), controls L132–136 (L26), L137–143 (L27) |
| `review-2.gap-3` | The tutorial/report acceptance requirement remains open. | The requirement in Q0 (L25); no page at S2 | `s3` | The lesson page @S3; PR #120 body, item 3 |
| `review-2.reassessed.findings-2-3` | The byte-validation and generic-crash findings are fixed. | Review text only | — | A reviewer's reassessment, `approved`; the only approval anywhere in the history |
| `review-3.finding-1` (second-hand) | nothing required valid trace evidence to exist for an arm whose expected open-count was already zero | `Reconcile.pkl` @S3 L100–112 | `s4` | `Reconcile.pkl` @S4 L134–147 · control L144–147 (L28) |
| `review-3.finding-2` (second-hand) | the independent-read check still only did a bare substring match on the retained trace text | `Reconcile.pkl` @S3 L24–31 | `s4` | `Reconcile.pkl` @S4 L24–43; `run_arms.sh` L41–60 · controls L148–152 (L29), L153–157 (L30), L158–162 (L31) |

Three things this map shows that a "resolved" badge would hide:

- **The retained detector output never changed.** `reports/diagnostics.json` is
  an empty list for every arm at S2, S3 and S4, byte for byte. The checker said
  nothing in the recorded data; every finding is the reviewers' mutation, which
  is why findings are review evidence and not detector flags.
- **Review 1's five mutations map onto S2's negative controls** (CIT-306's
  reading of the two lists): a generic crash → L76, emptied pixels → L87,
  corrupted PNG pixels → L94, a deleted trace → L98, a forged blocked-arm read →
  L102. The last two mutate the derived count, which is exactly review 2's
  first gap; they are closed on the retained trace at S3 (L123, L127) and, for a
  blocked arm's wholly deleted trace, at S4 (L144).
- **No reviewer approved any later fix, and nothing reviewed S4.** The
  corrections' own verdicts are `review: pending`. The single `approved` is
  review 2's reassessment of two earlier findings.

Relations between findings (`RELATIONS`) say which later evaluation restates,
reassesses or follows up which earlier one, with the reviewer's quote where the
words make the link (`quoted`) and `inferred` where CIT-306 read it.

## Capture of the sequence (data-level, not a UI capture)

No walkthrough UI exists, so there is **no UI capture**. What follows is generated from the recording alone, with the lesson prose hidden: the prefix that `deriveReplaySnapshot` returns at each of the nine cursors, and an excerpt of the plain-text projection that `sequence.spec.ts` uses to check the sequence can be followed without the lesson.

**What the prefix holds at each cursor.** Evaluations never decrease, evidence is offered only once it exists, and what was not captured is counted, not hidden. The only approval is review 2's reassessment of two earlier findings.

| Cursor | Frames | Evaluations | Evidence offered | …not captured | Flagged | Approved | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `q0-question` | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `s1-claimed-result` | 2 | 1 | 11 | 1 | 0 | 0 | 1 |
| `r1-review` | 3 | 5 | 24 | 5 | 4 | 0 | 1 |
| `s2-correction` | 4 | 6 | 66 | 5 | 4 | 0 | 2 |
| `r2-re-review` | 5 | 10 | 80 | 9 | 7 | 1 | 2 |
| `s3-correction` | 6 | 11 | 117 | 9 | 7 | 1 | 3 |
| `r3-review` | 7 | 13 | 125 | 13 | 9 | 1 | 3 |
| `s4-follow-up` | 8 | 14 | 148 | 13 | 9 | 1 | 4 |
| `landed` | 9 | 15 | 153 | 14 | 9 | 1 | 5 |

**One finding across the correction.** `review-1.finding-1` offers three items at `r1-review`: the review's own text, the source it cites, and the mutation output marked *not captured*. At `s2-correction` the same evaluation offers fourteen: those three plus the eleven that answer it: three source changes (the collector, the schema and the checker), and four test facts and negative controls, each paired with the line of the retained JUnit report that lists it as passing. Deriving the snapshot at `r1-review` with `review-1.finding-1/s2.checker` still selected returns the three items, no selection, and `selectionFailure: selection-not-in-prefix`.

**Excerpt of the plain-text projection**: the newest frame at five of the nine cursors. Every line is copied verbatim from the generated text; `⋮` marks lines omitted here, and the `──` separators are added.

```text
── cursor q0-question ──
[q0-question] CIT-294 issue (client): pose the original question and criteria (historical issue text)
  pin Q0 · original question and criteria — historical issue text (CIT-294, created 2026-10-03T22:56:40Z, text as retrieved 2026-10-04), not a sealed declaration: nothing was registered before this run
    Run one pinned Rails/libvips/libmatio/HDF5 configuration against three inputs/arms:
  ⋮
    2. **Blocked MATLAB/HDF5 canary:** the same input/configuration with untrusted loaders blocked refuses the path; retain loader-blocking/refusal evidence and show no dummy-file read/disclosure. A generic crash alone is insufficient.
── cursor r1-review ──
[r1-review] reviewer (client): review #117 and request changes
  pin Q1 · question raised by review 1 of #117
    Framing (CIT-305): can the checker certify contradictory or incomplete evidence?
    Recorded wording: “its authoritative checks can certify contradictory or incomplete evidence”
  review flagged: Recommendation: request changes before treating CIT-294 as complete.
  review-1.finding-1 [review:flagged] The independent file-read evidence never reaches the checker.
    - recorded-review-prose · Review 1, finding 1 (recorded review text) — linear-CIT-294-comment-97e70a90.md (capture linear:CIT-294:comment:97e70a90), line 5
    - source · Source cited by review 1 (run_arms.sh:21–30) — run_arms.sh @ S1 20aafd26, lines 21–30
    - captured-execution-output · Original mutation output — not captured :: Review 1 made these mutations in temporary copies (a deleted trace; a dummy-file read forged into the blocked arm). No output of those runs is retained in any retrievable source, so the review text is the only record of the result.
  ⋮
── cursor r2-re-review ──
[r2-re-review] reviewer (client): review #118 and keep changes requested
  pin Q2 · question raised by review 2 of #118
    Framing (CIT-305): did #118 close all five mutations?
    Recorded wording: “The PR's claim that all five exact mutations are fixed is therefore inaccurate.”
  review flagged: Recommendation: keep changes requested.
  review-2.gap-1 [review:flagged] The trace negative controls mutate the derived count, not the retained trace.
  ⋮
  review-2.reassessed.findings-2-3 [review:approved] The byte-validation and generic-crash findings are fixed.
── cursor r3-review ──
[r3-review] reviewer (client): review #120 (second-hand account only)
  pin Q3 · question raised by review 3 of #120 — second-hand account: the original review text could not be retrieved
    Framing (CIT-305): does the trace check require a parsed, successful open of the exact path, and any evidence at all for a zero-count arm?
    Second-hand wording (cc23e89 commit message): “the independent-read check still only did a bare substring match on the retained trace text, and nothing required valid trace evidence to exist for an arm whose expected open-count was already zero”
  review flagged: Findings reported second-hand; the review’s recommendation is not retrievable.
  review-3.finding-1.second-hand [review:flagged] nothing required valid trace evidence to exist for an arm whose expected open-count was already zero
    - recorded-review-prose · Review 3, original text — not captured :: The original text of review 3 could not be retrieved: no review or review thread on GitHub PR #120 (only a Netlify bot comment), only a Netlify thread in Linear, and no comment on CIT-303. See captures/review-3-retrieval-check.json. The findings below are second-hand.
  ⋮
── cursor landed ──
[landed] git (agent): merge #120 to main
  pin S5 · merge commit on main
    bc97c0e62fba3e66458e6b663ef4df5da37ebc31 — parents be95c86ea1fddd8913cab7577f2405c1a2e90205 (main before) and cc23e89297855dd07b1ee477ced455ab46a94738 (#120 head).
  landed.merge-to-main [review:pending] Merged to main as bc97c0e (parents be95c86 and cc23e89). No review of the final revision, cc23e89, is recorded.
  ⋮
    - recorded-review-prose · A review of the final revision — not captured :: No review of cc23e89 is recorded: GitHub shows no review on #120, Linear shows none, and review 3’s own original text is also unretrievable (captures/review-3-retrieval-check.json). Merged is not reviewed.
```

## Absence and deferred work, named

Missing records are explicit evidence, each with a reason, never filled in: no
sealed declaration, no Proton Pass observation, review 3's original text (the
searches are in `captures/review-3-retrieval-check.json`), the output of the
reviewers' mutation runs, a retained check result at S1, a retained report of
the flags the mutations raise, any review of S4, the pre-rewrite S3 and S4
commits, and the TutorialKit page at S2. `REVIEW_HISTORY_MISSING_RECORDS` lists
them and `sequence.spec.ts` checks each against the recording both ways.

Deferred, not started, **not completed by this replay**: typing a new or post
hoc question (T12), grey suggestions (T13), selecting a different premise
(T14), selecting a hypothetical commit or branch (T15), all under CIT-304; and
registering a declaration before a run, under CIT-233 (no Register action
exists here).

## Contract gaps found while building against CIT-299

None blocks this change; each is carried in CIT-306's data and reported to its
owner rather than patched around in the contract.

1. **`deriveReplaySnapshot` filters `evaluation.evidence` but passes
   `evaluation.diagnostic` through untouched.** A producer that puts a later
   location in `diagnostic.related` or `subject` leaks it at an earlier cursor.
   The recording keeps later material in `evidence` only, and the specs fail if
   it does not (I checked by putting one in `related`). *Owner: CIT-299.*
2. **`EvidenceRef` has no display label.** Labels live in
   `REVIEW_HISTORY_EVIDENCE_LABELS`, keyed by evidence id; the drafts above
   show hosts otherwise fall back to a path or to hard-coded wording. *Owner:
   CIT-299 or CIT-301.*
3. **There is no relation between evaluations.** Restates, reassesses and
   follows-up are in `RELATIONS`. *Owner: CIT-299 or CIT-301.*
4. **`ArtifactRef.identity` carries one revision spelling.** S1 and S2 have a
   reviewed and a merged spelling of the same content; the recording pins the
   reviewed one and the manifest records the equivalent. *Owner: CIT-253.*
5. **There is no "select a revision" selection** (T10). A revision is selected
   as the frame that carries it; comparing S1 with S2 needs two refs to the same
   path, both in the prefix once the cursor reaches S2. *Owner: CIT-301.*
6. **Checkpoint frames have no `method`**, so the existing warm-log mapping
   renders them as `sent`. They are checkpoints, not wire exchanges, and a
   made-up `session/prompt` would pretend otherwise. *Owner: CIT-300 or CIT-301
   to decide how they render.*
7. **`EvidenceRef.contentKind` has no value for recorded prose that is not a
   review.** A PR body, an issue description and a commit message are recorded
   here as `source`, and the three kinds the contract offers are `source`,
   `captured-execution-output` and `recorded-review-prose`; calling an author's
   claim "review prose" would be wrong, and so is "governing rule". The
   recording's evidence-class labels say what each item is; a host that keys on
   `contentKind`, as the #126 draft does, will not. *Owner: CIT-299 or CIT-301.*

## Commands and results

Passed, failed and skipped are reported separately. "Skipped" is never a pass.

| Command | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| `cd tutorial-app && npx vitest run src/lib/reviewHistory` | 85 (20 bundle, 58 sequence, 7 lesson) | 0 | 0 here. The git-object cross-check inside `bundle.spec.ts` runs only where the pinned commits exist locally; it ran here and skips on a shallow checkout |
| `cd tutorial-app && npx vitest run` (whole suite) | 265 in 21 files | 0 | 2, both already skipped on `main`: the `FollowerMaze.pkl` parity tests, which need `pkl`. `main` alone: 180 passed, 2 skipped, 18 files |
| `node tutorial-app/evidence/cit-294-review-history-v1/collect.mjs --verify` | 47 files and 16 captures verified | 0 | 0 |
| `cd tutorial-app && npm run build` | 27 pages built, exit 0, the corrected lesson included | 0 | 0 |
| Headless Chromium on `astro preview` of that build, loading `/part-4/rails-matlab-canary/1-the-check-that-finally-checks/` (a scratch script, not committed) | 19 checks: the corrected text present, both old claims absent, 8 repository links, no page errors | 0 | 0 |
| `cd tutorial-app && npx playwright test --config=playwright.review-history.config.ts` | 0 | 0 | **2**: the walkthrough acceptance (gated on `REVIEW_HISTORY_ACCEPTANCE`) and a `fixme` for TutorialKit. Never run with the gate on: there is no story to run against |
| Scratch, not committed: the recording through the draft controller, resolver and story (PR #126 and #125, merged in a throwaway worktree) | 8 (7 compatibility checks, and 1 that asserts the draft hard-codes Follower Maze label text) | 0 | 0 |
| `cd tutorial-app && npx tsc --noEmit` | n/a | 138 errors. Measured on this tree with this change's files excluded: 117, so 21 come from this change. The repository does not type-check clean on `main` | 0. All 21 are "cannot find module `node:…`" (11) or "cannot find name `process`/`Buffer`" (10) in the spec and config files, because `@types/node` is not installed in this checkout; 100 of the 117 existing errors are the same class. The library modules under `src/lib/reviewHistory/` (not the specs) have none |

Each guard was also checked by sabotage, and each was caught with a message
naming the item: a shifted line range, a changed anchor, one altered word in a
quoted message, a range past the end of a file, a flipped byte in a bundled
file, a stray unlisted file, one word changed in a saved review, a later
location placed in `related`, an answer offered at the review frame, a claim
marked approved, and a step labelled `working`.

## Where to look

- Intended Storybook id: **none exists** for this walkthrough. The id the
  acceptance target uses is `lessons-rails-matlab-canary--review-history`; it is
  a guess for CIT-301 to confirm or replace (`REVIEW_HISTORY_STORY_ID`
  overrides it). Launch, once it exists: `cd tutorial-app && npm run storybook`.
  (Draft #126 adds a CIT-300 development story at
  `lessons-acp-trace-ghost-trace-machine--recorded-run-debugger`, over the
  Follower Maze recording, which is not this walkthrough.)
- TutorialKit: the corrected static page, at
  `/part-4/rails-matlab-canary/1-the-check-that-finally-checks/`. There is no
  interactive route.
- Not claimed: a working step, a UI capture, or browser acceptance of the
  walkthrough.
