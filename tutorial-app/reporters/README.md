# tutorial reporter

Playwright `@tutorial` tests emit TutorialKit lessons. Each top-level
`test.step` is one lesson. Indexed attachments declare before/after file
state, prose, screenshots and optional runtime metadata. The reporter
validates state continuity before writing output.

`compileTutorialTest(test, result, outDir)` is the compiler's entry point;
`reporters/tutorial.ts` is a Playwright `Reporter` that calls it once per
finished test. Wire it into any Playwright config as:

```ts
reporter: [['list'], ['./reporters/tutorial.ts', { outDir: './src/content/tutorial/<part>' }]],
```

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
});
```

- **Tag `@tutorial`**: everything else is ignored (`isTutorialTest` in
  `tutorial.ts`).
- **State continuity is enforced.** For every step `n > 1`, the files
  declared under `before/` must equal the cumulative end state of step
  `n-1`, path for path and byte for byte. Otherwise the reporter refuses to
  compile (see below). Step 1 has no predecessor, so its `before/` is
  unchecked; a step with no `before/` attachments declares an empty start.
- **Passed tests only.** A failing test is a broken storyboard: the
  reporter warns to the console and writes nothing.
- **Top-level steps only**: `category === 'test.step'` with no `.parent`.
  Hooks, fixtures, `expect` entries, and steps nested inside another
  `test.step` are all filtered out (`topLevelSteps`).
- **Step titles are stable and human.** They become lesson titles and
  slugs.
- **Attachments, indexed by step:**
  - `tutorial:<n>:before/file/<path>` -- file state at the *start* of step
    `<n>` (1-based). Becomes the lesson's `_files`. Attach the full set of
    files the page shows, after the story has loaded.
  - `tutorial:<n>:file/<path>` -- file state at the *end* of step `<n>`,
    merged onto the previous step's end state (cumulative). Becomes
    `_solution`.
  - `tutorial:<n>:prose` -- that step's lesson body markdown.
  - `tutorial:<n>:meta` -- optional JSON attachment with runtime/display
    frontmatter (`template`, `prepareCommands`, `mainCommand`, `previews`,
    `terminal`, `editor`, `focus`, `filesystem`). Explicit values override
    defaults, including inferred `focus`. Fields that would rewrite lesson
    identity (e.g. `title`) are rejected during planning, before any write.
  - any `tutorial:<n>:*` attachment whose `contentType` starts with
    `image/` -- that step's `frame.png`.
  - anything else is ignored, so Playwright's own trace/video attachments
    never leak into a lesson.

  A small `attachTutorial(testInfo, index, name, options)` helper (write
  one per test file) keeps the index from drifting away from the step it's
  attached inside.

## Why attachments carry a step index

`TestStep.attachments` is declared in
`node_modules/playwright/types/testReporter.d.ts`, but at runtime (checked
against Playwright 1.59.1) every `testInfo.attach()` call made inside a
`test.step()` body lands on `TestResult.attachments` in call order, with
`TestStep.attachments` always empty. Confirmed live with a throwaway debug
reporter that dumped both arrays after a real run.

So the reporter uses the `tutorial:<n>:` prefix (`groupAttachmentsByStepIndex`
in `tutorial.ts`) as the load-bearing mechanism, not an optional extra. If a
future Playwright version starts populating `TestStep.attachments` for
real, this scheme still works without changes to the test file -- it just
stops being load-bearing.

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
   - `_files/` = the step's own `before/file/*` attachments.
   - `_solution/` = the previous step's end state merged with this step's
     `file/*` attachments.
   - `frame.png` if a screenshot attachment was found.
   - `content.mdx`: `type: lesson`, `title: <step title>`, `template:
     default` (see below), `focus: /<file>` for the first file (alphabetical) this step
     changes that also exists in `_files` -- omitted when the step only
     introduces new files, plus the step's prose and (if present) a `![Frame](./frame.png)`
     reference.

Planning (resolving every lesson's before/after and checking continuity)
happens in a pure pass before anything is written, so a broken storyboard
leaves the previous output untouched.

`template: default` (`src/templates/default`, a `sleep infinity` no-op) is
used for every generated lesson unless overridden via `tutorial:<n>:meta`:
these lessons are a file-state diff to read and Solve, not necessarily a
running preview, and `default` is the cheapest WebContainer boot that still
gives an editor + file tree + Solve button.

## State continuity

Attachments capture only each step's *end* state, a file a step introduces
never exists in that lesson's `_files` unless declared under `before/`. The
reporter compares what a step declares as its start state against where
the previous step ended:

```
[tutorial-reporter] refusing to compile "area51 booking": tutorial state continuity broken:
  - reason.txt: differs -- end of step 1 ("reason does not compile") "...#A51-7" vs start of step 2 ("decision is typed") "...#A51-8"
```

A continuity failure writes nothing, leaves any existing output as it was,
and makes `onEnd` return `{ status: 'failed' }`, so a compile run consuming
this reporter exits non-zero even though the Playwright test itself passed.

Not covered: continuity is about *files*. A step can't delete a file (the
cumulative end state only grows), and nothing checks that `prose` still
matches the files.

## Determinism

No timestamps or random IDs are introduced anywhere in the compile path,
so a consuming test that avoids live network calls and unstable rendering
(e.g. blurring focus and waiting a frame before a screenshot) gets a
byte-identical output tree across repeated compiles.

## Testing

Unit tests for the reporter's pure logic (`slugify`, `topLevelSteps`,
`classifyAttachment`, `groupAttachmentsByStepIndex`,
`compileTutorialTest`, including the failing-test-produces-no-output case)
live in `tutorial.spec.ts` and run with the rest of the suite via `npm
test` (vitest).
