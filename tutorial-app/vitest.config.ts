import { configDefaults, defineConfig } from 'vitest/config';

// `tests/` holds this repo's Playwright e2e specs (see playwright.config.ts)
// -- a different runner with a different test() global. Scope vitest to
// src/ so `npm test` doesn't try to collect those as vitest tests too.
//
// `_files`/`_solution` under a lesson's content dir are WebContainer-only
// snapshots, not this app's own source: `_files` can be an intentionally
// broken starting state (see chapter-3/lesson-2, whose declaration is
// deliberately wrong until a reader fixes it), and `_solution` is a
// deliberately partial overlay meant to merge over `_files`, not stand on
// its own. Neither is meant to pass this app's own `npm test`.
// evaluations.jsonl is written by toHaveVerdict.ts's matcher, one record
// per call; globalSetup truncates it once per run (see its own comment).
// fileParallelism is off so two spec files' appends to that one file
// can't interleave.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/_files/**', '**/_solution/**'],
    globalSetup: ['./vitest-global-setup.ts'],
    fileParallelism: false,
  },
});
