# Demo: what did the summary lose?

Two minutes. The thread is synthetic (8 messages, a retry-backoff change to a
billing webhook). In message 3 the user says "go ahead and implement" and, as
a separate paragraph, "Do not deploy this to production until I have reviewed
the diff myself." The summary drops that paragraph. It also drops a pytest log
from message 4, which it rightly should.

## Setup (before the interview)

    cd examples/deploy-approval
    python3 -I ../../pkl_thread.py --summarize summarize.json --full full.json out
    pkl eval out/thread.pkl > /dev/null      # the summary is a type-checked Pkl module

Neovim 0.11+ with the witness language server on PATH. `editor/init.lua` loads
witness.lua and adds the `pkl` filetype it ships without. Verified in Neovim
0.11.4 headless with `editor/check.lua`: `out/` shows lines 27 and 33,
`out-repaired/` shows only line 33.

## Script

1. **Open the file** (0:00). `cd out && nvim -u ../../../editor/init.lua thread.pkl`. Say: this is the
   summary an agent would carry forward after compaction, as a Pkl module. Each
   summary block is a typed record. The full thread is not in the file.

2. **Show the diagnostic** (0:20). Line 27, block 2 (the user's approval):
   `message 3 (user) dropped prose: "Do not deploy this to production until I have reviewed the d…"`.
   The diagnostic quotes the lost text, so the important loss is readable
   without opening anything. Read the block below it: "The plan looks right. Go
   ahead and implement it and add the tests." Say: read alone, this summary
   reads as permission to ship. (`screenshot.png` is this view.)

3. **Jump to the evidence** (0:45). Go-to-definition (`gd` or
   `vim.lsp.buf.definition()`) on line 27 opens
   `.witness/run/evidence/m3-partial.txt`, the full lost text with its
   original line breaks:
   "Do not deploy this to production until I have reviewed the diff myself."
   That is the sentence the summary lost, and it is the one that matters. The
   final summary line, "CI is green, so it is ready for the next step", is now
   misleading.

4. **Contrast with the harmless omission** (1:05). Line 33, block 3:
   `message 4 (assistant) dropped log/tool output: "$ pytest tests/test_retry.py -v tests/test_retry.py::test_fi…"`.
   Go-to-definition shows the five-line pytest log. Losing that is correct; the
   summary says "ran tests (5 passed)". Say: both are `information`; the
   detector only labels a paragraph "log/tool output" by a line-shape
   heuristic (commands, `[tool]` lines, test ids, PASSED/FAILED), and the label
   is not a judgment of importance. A human decides which loss matters, in
   seconds, because the quoted text is right there.

5. **Apply the repair** (1:25). Diff `summarize.json` against
   `summarize-repaired.json`: one sentence added to block 2, "Do not deploy
   this to production until I have reviewed the diff myself." Regenerate
   (`python3 -I ../../pkl_thread.py --summarize summarize-repaired.json --full
   full.json out-repaired`), open `out-repaired/thread.pkl`: the line-27
   diagnostic is gone, the line-33 one (harmless log) remains
   (`screenshot-repaired.png`).

6. **State the limit** (1:45). The detector is structural: it checks whether
   each paragraph's first 120 characters appear in the summary. It has no
   notion of meaning. It cannot tell a constraint from a log, and a paraphrased
   constraint would still be flagged, so the repair above had to restore the
   sentence verbatim. Semantic judgment (which losses matter) and automated
   repair (rewriting the summary to restore them) are the next experiment.
   They are not built.

## What was verified (when this was written)

- `pkl eval` passes on `out/thread.pkl`, `out-repaired/thread.pkl` and the
  private thread-6 output.
- Neovim 0.11.4, headless, `editor/check.lua`: `out/` gives line 27 and line 33;
  `out-repaired/` gives only line 33.
- Over raw LSP, go-to-definition on line 27 returns `evidence/m3-partial.txt`.
- `screenshot.png` and `screenshot-repaired.png` are a tmux capture of a real
  nvim session (ANSI converted to HTML, rendered in Chromium), not a mock-up.
