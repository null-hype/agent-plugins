---
type: lesson
title: Where does a wrong answer show up
editor: false
previews: false
terminal: false
---

# Where does a wrong answer show up?

A question is written down before anything runs. It says what to ask, who
answers, and the range a sound answer falls in. Then the run happens, and the
answers come back.

The answers belong on the questions. Not in a separate report you have to
open, but in the file where the question was written, the way a type error
sits on the line that caused it.

## The question, asked of a leaky app

The document app from earlier has a baseline policy that lets any signed-in
user read any document. One question asks: *can Alice read Bob's private
document?* A sound policy answers no, so its expected range is 0 to 0.2.

The questions live in `jev-playwright/report-expected.pcf`. A run asks each
one, records the evidence, and reconciles every answer against its range.

This run uses canned answers, not Jev. The canned answer for Alice is 0.95:
the leak, recorded as data.

## One problem, on one line

`jev-lsp` is a language server. It reads the run and publishes a diagnostic on
each question whose answer needs attention. Open the `.pcf` and the finding is
on the question that produced it:

<figure style="margin:1.25rem 0">
  <a href="/sketches/jev-lsp/diagnostic.svg"><img src="/sketches/jev-lsp/diagnostic.svg" style="display:block;width:100%;max-width:420px;height:auto;border:1px solid #e4e6e9;border-radius:8px;background:#fff" alt="report-expected.pcf in an editor. Line 82, baseline-alice-reads, is underlined, with the message: Mock answer 0.95, outside expected [0, 0.2]. No other line has a problem." /></a>
  <figcaption style="margin-top:.5rem;font-size:.875rem;color:#6b7280">Drawn from what jev-lsp published for the recorded run.</figcaption>
</figure>

It is a **warning**, not an error. An answer outside its range is a result, so
the run still passes. Only an answer that could not be collected is an error.

The other three questions answered inside their ranges, so they show nothing.
The patched revision's Alice question is among them: the owner check closed
the leak.

## Peek at the evidence

Go to definition on the question opens the evidence the answer was given on.
Most editors show it as a peek:

<figure style="margin:1.25rem 0">
  <a href="/sketches/jev-lsp/peek.svg"><img src="/sketches/jev-lsp/peek.svg" style="display:block;width:100%;max-width:420px;height:auto;border:1px solid #e4e6e9;border-radius:8px;background:#fff" alt="Peek on baseline-alice-reads listing state.json, request.json and response.json. state.json shows the policy (_user, _document) => true, and a GET of /documents/bob-private as Alice returning 200 with Bob's document." /></a>
  <figcaption style="margin-top:.5rem;font-size:.875rem;color:#6b7280">The first of the three files go to definition returned, as recorded.</figcaption>
</figure>

The policy returns `true` for everyone. Alice asked for Bob's document and got
it, with a 200. That is what the answer was judged on.

`request.json` is what was sent to the answerer, with no expected range in it.
`response.json` is what came back.

## How these figures are made

Both figures are drawn by running the server. `npm run jev-lsp:render` starts
`jev-lsp`, opens the real `report-expected.pcf` against the recorded run, and
draws the diagnostics and peek locations it returns. `npm run jev-lsp:check`
fails if a figure no longer matches a fresh run. Both need Go.

They are black-and-white sketches. They will be filled in as more of the
editor view is verified.

## What this does not show

- **A live run.** The server reads the newest run next to the `.pcf`. It does
  not run the questions itself.
- **Jev.** Every answer here is canned, and the warning says so.
- **Your editor.** The figures come from the server's protocol output, not
  from a screenshot of an editor. Setup for Neovim is in
  [`jev-playwright/lsp`](https://github.com/null-hype/agent-plugins/tree/main/jev-playwright/lsp).
