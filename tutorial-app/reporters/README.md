# tutorial reporter (CIT-235 spike)

Compiles a passing `@tutorial`-tagged Playwright test into TutorialKit
lessons: one lesson per top-level `test.step`, `_files` the state *before*
the step, `_solution` the state *after*. "Solve" on a lesson therefore
advances exactly one frame.

This is the spike from [CIT-235](https://linear.app/citizen6librarian6refrain4/issue/CIT-235) --
it proves the seam between Playwright and TutorialKit for one test, three
steps, one reporter. It does not build a real demo UI (see
`src/components/Area51Booking.tsx` and `src/stories/Area51Booking.stories.tsx`
for the throwaway one), and it does not do nested steps, multiple tests,
parts, or a Pkl evidence model -- see CIT-235 for the full "Out" list.

## Test contract

A compiled test:

```ts
test('area51 booking', { tag: '@tutorial' }, async ({ page }, testInfo) => {
  await test.step('reason does not compile', async () => {
    // drive the page, assert observable state
    await attachTutorial(testInfo, 1, 'file/reason.txt', { body: '...', contentType: 'text/plain' });
    await attachTutorial(testInfo, 1, 'prose', { body: 'Lesson body markdown', contentType: 'text/markdown' });
  });
  await test.step('decision is typed', async () => { /* ... */ });
  await test.step('runnable appears', async () => { /* ... */ });
});
```

- **Tag `@tutorial`**: everything else is ignored (`isTutorialTest` in
  `tutorial.ts`).
- **Passed tests only.** A failing test is a broken storyboard: the
  reporter warns to the console and writes nothing.
- **Top-level steps only**: `category === 'test.step'` with no `.parent`.
  Hooks, fixtures, `expect` entries, and steps nested inside another
  `test.step` are all filtered out (`topLevelSteps`).
- **Step titles are stable and human.** They become lesson titles and
  slugs.
- **Attachments, indexed by step:**
  - `tutorial:<n>:file/<path>` -- file state at the end of step `<n>`
    (1-based), cumulative across steps.
  - `tutorial:<n>:prose` -- that step's lesson body markdown.
  - any `tutorial:<n>:*` attachment whose `contentType` starts with
    `image/` -- that step's `frame.png`.
  - anything else is ignored, so Playwright's own trace/video attachments
    never leak into a lesson.

  `tests/area51-booking.spec.ts` wraps this in an `attachTutorial(testInfo,
  index, name, options)` helper so the index can't drift from the step it's
  attached inside.

## Why attachments carry a step index

CIT-235's sketch flagged this as the open question: does
`TestStep.attachments` actually work in the installed Playwright version,
or do attachments arrive flat on `TestResult.attachments`?

Checked against Playwright 1.59.1: **flat.**
`node_modules/playwright/types/testReporter.d.ts` *declares*
`TestStep.attachments`, but at runtime every `testInfo.attach()` call made
inside a `test.step()` body lands on `TestResult.attachments` in call
order, with `TestStep.attachments` always empty. Confirmed live with a
throwaway debug reporter that dumped both arrays after a real run -- three
steps, nine attachments, all nine on `result.attachments`, zero on any
step.

So the reporter uses the `tutorial:<n>:` prefix CIT-235's sketch names as
the fallback (`groupAttachmentsByStepIndex` in `tutorial.ts`), not as an
optional extra. If a future Playwright version starts populating
`TestStep.attachments` for real, this scheme still works without changes
to the test file -- it just stops being load-bearing.

## Compilation

`compileTutorialTest(test, result, outDir)`:

1. `topLevelSteps(result)` for the ordered step list; `slugify(test.title)`
   for the chapter directory name under `outDir`. That directory is wiped
   and rewritten from scratch on every compile (no stale lessons left
   behind by a renamed or removed step).
2. Writes `<outDir>/<chapter>/meta.md` (`type: chapter`, `title: <test
   title>`).
3. `groupAttachmentsByStepIndex(result.attachments)` once, then per step
   `i` (0-based, `stepIndex = i + 1`):
   - `_files/` = the running cumulative file set *before* this step.
   - `_solution/` = that set merged with this step's own file
     attachments.
   - `frame.png` if a screenshot attachment was found.
   - `content.mdx`: `type: lesson`, `title: <step title>`, `template:
     default` (see below), `focus: /<first new file>` when this step
     introduced one, plus the step's prose and (if present) a `![Frame](./frame.png)`
     reference.
   - the cumulative set becomes next step's `_files`.

`template: default` (`src/templates/default`, a `sleep infinity` no-op) is
used for every generated lesson rather than something that actually boots
a dev server: these lessons are a file-state diff to read and Solve, not a
running preview, and `default` is the cheapest WebContainer boot that
still gives an editor + file tree + Solve button.

## Determinism

No timestamps, random IDs, or live network calls anywhere in the
compile path. Verified directly: ran `npm run compile-tutorial` twice in a
row and `diff -rq`'d the two output trees, byte for byte, including the
three `frame.png` screenshots -- identical.

The one thing that *could* threaten this is screenshot rendering
(anti-aliasing, a blinking text-input caret, an in-flight CSS transition).
`tests/area51-booking.spec.ts`'s `stableScreenshot()` blurs focus and waits
one frame before every capture specifically to remove the caret as a
variable; the component itself (`Area51Booking.tsx`) has no animation and
no time-based rendering. Byte-identity is a same-machine guarantee (same
Chromium build, same font rendering) -- it is not claimed across different
OSes or Chromium versions.

## Invocation

```
npm run compile-tutorial
```

Runs `playwright test --config=playwright.tutorial-compile.config.ts`,
which:

- Boots Storybook (`npm run storybook -- --ci --quiet`) as its `webServer`
  -- no Astro app involved, and (per the test contract) no live network
  either way.
- Runs `tests/area51-booking.spec.ts`, the one `@tutorial` test. Each step
  navigates to `/iframe.html?id=<story id>&viewMode=story` for the
  Storybook story ([`Area51Booking.stories.tsx`](../src/stories/Area51Booking.stories.tsx))
  whose `args` are that step's *starting* state, then drives the page
  directly with Playwright -- the stories have no `play` function; the
  Playwright test is the only thing that ever changes the page.
- Writes lessons to `src/content/tutorial/part-2` via `reporters/tutorial.ts`
  as the `reporter`. `src/content/tutorial/part-2/meta.md` (`type: part`,
  "Spikes") is hand-authored, not generated -- the reporter only ever
  writes one chapter directory inside a part that already exists.

The generated `src/content/tutorial/part-2/area51-booking/` directory is
committed (it's a small, fully-deterministic build output, the same as
every other lesson under `src/content/tutorial/`) so `npm run dev` can
render it without a separate build step. Re-run `npm run compile-tutorial`
after editing the test or the component and commit the result.

Unit tests for the reporter's pure logic (`slugify`, `topLevelSteps`,
`classifyAttachment`, `groupAttachmentsByStepIndex`,
`compileTutorialTest`, including the failing-test-produces-no-output case)
live in `tutorial.spec.ts` and run with the rest of the suite via `npm
test` (vitest).

## What differed from CIT-235's sketch

- **The attachment question resolved to "flat," not "nested"** -- see
  above. The `tutorial:<n>:` index prefix is required, not optional.
- **The driven page is a Storybook story, not a standalone static HTML
  file.** CIT-235's original scope named "a throwaway static HTML page";
  this was redirected mid-implementation to drive
  `iframe.html?id=<story>` instead, with each step's starting state
  expressed as Storybook `args` on its own story
  (`Step1ReasonDoesNotCompile` / `Step2DecisionIsTyped` /
  `Step3RunnableAppears`). This keeps the Playwright test as the only
  storyboard driver (no `play` function) while making each step's starting
  condition independently reviewable in Storybook, consistent with how
  this repo already treats stories as lesson-adjacent artifacts (see
  CIT-204).
- **`_solution` writes the full cumulative file set, not just the diff.**
  CIT-235's pseudocode does this too (`_solution/* = files`, cumulative);
  called out because the rest of this app's hand-authored lessons (e.g.
  `part-1/chapter-1/lesson-1`) only put *changed* files in `_solution` and
  rely on TutorialKit overlaying it onto `_files`. Both are correct
  (unchanged files just get overwritten with identical content); this
  reporter follows CIT-235's pseudocode rather than the hand-authored
  convention.
- **`focus` is a heuristic**, not part of the original contract: the first
  file a step's attachments introduce, if any. Good enough for a
  single-new-file-per-step test like this one; a step that introduces
  multiple files would need a real answer before this goes past spike
  stage.
