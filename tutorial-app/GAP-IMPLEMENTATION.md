# GAP: the first working slice

The deployed application is `tutorial-app/` in `null-hype/null-hype.github.io`.
The root Netlify configuration builds this directory and publishes its `dist/`.
`null-hype/tutorial-kit` is a separate repository whose current branches do not
contain these deployed German lessons.

## What the German exercise demonstrates today

| GAP role | Implementation | Boundary |
| --- | --- | --- |
| Authored rule | `LoanwordRules.pkl` in each lesson | Describes the source form and vocabulary-admission policy. |
| Runtime artifact | `loanword-runtime.json` | Checked in separately; there is no Pkl-to-JSON generation step here. |
| Proposal | Editable `translation.en` | Compared with the configured canonical string after trimming whitespace. |
| Vocabulary gate | `inspectVocabulary` in `src/lib/loanwordArcProtocol.ts` | Limited text inspection, not Pkl evaluation; not suitable as an authorization boundary. |
| Feedback | `LoanwordArcBridge` | Shows blocked, pending-admission, idle, and accepted states without requiring the preview to boot. |
| Result illustration | `otel-warm-log` template | Scripted example selected by validation state, not observed agent execution or telemetry. |

The preview announces readiness to the parent. The bridge answers with the
latest state, including after a slow WebContainer startup or a preview reload.
Edits also publish immediately to existing preview frames.

## Validation

Run `npm ci`, `npm run build`, then `npx playwright install chromium` and
`npx playwright test` from this directory. For an existing Chromium installation,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path.

The focused browser regression test delays the real preview document beyond
the former 6.4-second publication window. It checks rejection, vocabulary
admission, successful completion, preview reload, revocation, empty input,
and navigation to the rule and runtime artifact. Existing exploratory dump
and navigation scripts remain available but are not assertion-based release checks.

## Next proof to build

Generate the runtime artifact from the reviewed Pkl rule and verify that a
rule change updates the artifact. Replace vocabulary text inspection with an
explicit supported input format and validated runtime representation. Then
introduce an action executor behind that validator and test that rejected
proposals never reach it. This would demonstrate compiled expertise and
enforcement; the present slice demonstrates proposal feedback and a simulated result.

The legacy thesis is reference material:
https://linear.app/tidelands-dev/issue/PLAN-229/the-four-layer-stack

New decisions are tracked in the MCP-connected workspace. Editorial review
of the loanword acceptance policy: CIT-31.
