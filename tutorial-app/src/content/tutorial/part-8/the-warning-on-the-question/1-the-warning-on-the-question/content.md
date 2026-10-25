---
type: lesson
title: Where does a wrong answer show up
editor: false
previews: false
terminal: false
---

# Where does a wrong answer show up?

A question is written down before anything runs: what to ask, who answers, and
the range a sound answer falls in. Then the run happens, and the answers come
back.

The answers belong on the question. Not in a separate report you have to open,
but on the line that asked it, the way a type error sits on the line that
caused it.

## The question, asked of a leaky app

The document app from earlier has a baseline policy that lets any signed-in
user read any document. One question asks: *can Alice read Bob's private
document?* A sound policy answers no, so its expected range is 0 to 0.2.

The question is an ordinary Playwright test, titled with its words, in
`jev-playwright/tests/questions.spec.ts`. The test gathers the evidence. The
range lives apart from it, in `report-expected.pcf`, written down before the
run, along with which revisions the test is asked of.

This run uses canned answers, not Jev. The canned answer for Alice at the
baseline is 0.95: the leak, recorded as data.

## One problem, on one line

`jev-lsp` is a language server. It reads the run and publishes a diagnostic on
each test whose answer needs attention. Open the spec and the finding is on the
test that asked:

<figure style="margin:1.25rem 0">
  <a href="/sketches/jev-lsp/diagnostic.svg"><img src="/sketches/jev-lsp/diagnostic.svg" style="display:block;width:100%;max-width:420px;height:auto;border:1px solid #e4e6e9;border-radius:8px;background:#fff" alt="tests/questions.spec.ts in an editor. Line 8, the test titled Can Alice read Bob's private document, is underlined, with the message: baseline-alice-reads: Mock answer 0.95, outside expected [0, 0.2]. Lines 8 and 14 have run markers. No other line has a problem." /></a>
  <figcaption style="margin-top:.5rem;font-size:.875rem;color:#6b7280">Drawn from what jev-lsp published for the recorded run. The run markers are the lines Playwright reported a test on.</figcaption>
</figure>

It is a **warning**, not an error. An answer outside its range is a result, so
the run still passes. Only an answer that could not be collected is an error.

The same test asks the patched revision too. That answer was in range, so it
adds nothing: the owner check closed the leak. Bob's test, on line 14, was in
range at both revisions.

The warning sits next to the test's run button. Run the test, and when the new
run lands the warning updates without reopening the file.

## Peek at the evidence

Go to definition on the test opens the evidence its answers were given on, for
every revision it asked. Most editors show it as a peek:

<figure style="margin:1.25rem 0">
  <a href="/sketches/jev-lsp/peek.svg"><img src="/sketches/jev-lsp/peek.svg" style="display:block;width:100%;max-width:420px;height:auto;border:1px solid #e4e6e9;border-radius:8px;background:#fff" alt="Peek on line 8 listing state, request and response files for baseline-alice-reads and patched-alice-reads. The baseline state shows the policy (_user, _document) => true, and a GET of /documents/bob-private as Alice returning 200 with Bob's document." /></a>
  <figcaption style="margin-top:.5rem;font-size:.875rem;color:#6b7280">The first of the files go to definition returned, as recorded.</figcaption>
</figure>

The policy returns `true` for everyone. Alice asked for Bob's document and got
it, with a 200. That is what the answer was judged on.

`request.json` is what was sent to the answerer, with no expected range in it.
`response.json` is what came back.

## Test and contract keep each other honest

The question's words are in two places on purpose: the test's title, and the
contract's `ask`. A question no test asks fails the run. So does a test no
question asks. Changing a test means changing the contract too, in the open.

## How these figures are made

Both figures are drawn by running the server. `npm run jev-lsp:render` starts
`jev-lsp`, opens the real `tests/questions.spec.ts` against the recorded run,
and draws the diagnostics and peek locations it returns. `npm run jev-lsp:check`
fails if a figure no longer matches a fresh run. Both need Go.

They are black-and-white sketches. They will be filled in as more of the
editor view is verified.

## What this does not show

- **Running the questions.** The server shows the newest run next to the tests.
  It does not run them itself.
- **Jev.** Every answer here is canned, and the warning says so.
- **A screenshot.** The figures come from the server's protocol output. Setup
  for Neovim is in
  [`jev-playwright/lsp`](https://github.com/null-hype/agent-plugins/tree/main/jev-playwright/lsp).
