Write `jev-lsp`, an npm package that lets any Playwright project ask Questions of its tests, from the jev-playwright harness below. Put every file you write under `package/`.

Decisions already made:

- Name `jev-lsp`, ESM, TypeScript sources Playwright can load directly. Peer dependency on `@playwright/test`.
- `import { test, expect } from 'jev-lsp'`: `test` has the harness's fixtures (`ask`, `question`, `prerequisites`); a test's title is its Question's words.
- `import { questions } from 'jev-lsp/config'`: `questions({ contract, answers?, backend? })` returns a Playwright config: one project per Question, the `unasked` project, global setup, and the reporters, as in the harness's `playwright.config.ts`. `contract` and `answers` are file URLs or paths. Runs go to `runs/<run id>/` next to the contract. The backend defaults to `mock` with `answers`.
- `pkl/Questions.pkl`, shipped in the package, is what a project's contract amends: `model` (default `jev-latest`) and `questions`, each a Question with `ask`, `judge`, `requiredEvidence`, `expected`, `dependencies`, and optional `use` (that project's Playwright `use` options). It validates the dependency graph like `Experiment.pkl`. Ship the Pkl modules it needs.
- Each run's `comparison.json` keeps the harness's shape, including each Question's `location`, so the `jev-lsp` language server can show it. Keep reconcile and the consistency checks.
- The Jev client is `$JEV_CLIENT` (default `jev` on `PATH`), run with `$JEV_PYTHON` when that is set. Live runs keep the harness's `pass-cli` reason handling.
- Leave out the document app, its collectors and its revisions: they are the harness's example, not the package.

It is done when the check below passes. The fresh project and the check are fixed.
